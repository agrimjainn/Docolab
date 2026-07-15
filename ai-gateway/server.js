// =============================================================================
// ai-gateway/server.js
//
// A key-injecting, grant-verifying reverse proxy in front of the AI vendors.
//
// WHY THIS SERVICE EXISTS
// -----------------------
// The editor's AI features (Plate + Vercel AI SDK) must keep streaming and
// tool-calling exactly as before, but the real vendor API keys must NOT live on
// the frontend. So the Next.js AI routes point each AI-SDK provider's `baseURL`
// at THIS service and send a short-lived, backend-signed "grant" (in the
// `x-ai-grant` header) instead of a vendor key. This gateway:
//
//   1. verifies the grant (HMAC signature + expiry, shared secret with backend),
//   2. checks the request targets the vendor+model the grant authorizes,
//   3. strips the caller's headers, injects the REAL vendor key,
//   4. forwards to the vendor and streams the response straight back.
//
// Because it only relays the vendor's native wire protocol, the AI SDK on the
// Next side still speaks its exact stream protocol — zero feature loss. Adding a
// vendor = one entry in VENDORS + one API-key env var.
//
// This mirrors the existing hocuspocus-server: standalone Node ESM service,
// dotenv + jsonwebtoken, no framework.
// =============================================================================

import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import 'dotenv/config';
import jwt from 'jsonwebtoken';

const PORT = Number(process.env.PORT || process.env.AI_GATEWAY_PORT || 8787);
const SECRET = process.env.AI_GATEWAY_SECRET;
const ALGORITHM = process.env.AI_GATEWAY_ALG || 'HS256';
const GRANT_TYPE = 'ai_grant';
// Backend base for reporting token usage (Phase 4 metering). Empty disables it.
const BACKEND_URL = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
// Cap how much of a response we buffer for usage extraction (usage totals live
// at the very end, but we scan the whole thing). Protects against huge bodies.
const USAGE_SCAN_CAP = Number(process.env.USAGE_SCAN_CAP_BYTES || 8 * 1024 * 1024);

if (!SECRET) {
  console.error('[ai-gateway] FATAL: AI_GATEWAY_SECRET is required (must match the backend).');
  process.exit(1);
}

// Per-vendor config: upstream base, the real API key, and how to authenticate.
// `inject(headers, key)` sets the vendor's auth on the outgoing request.
const VENDORS = {
  google: {
    base: 'https://generativelanguage.googleapis.com',
    key: () => process.env.GOOGLE_API_KEY,
    inject: (headers, key) => { headers.set('x-goog-api-key', key); },
    // model lives in the path: /v1beta/models/<model>:streamGenerateContent
    modelFromPath: (path) => (path.match(/\/models\/([^:/?]+)/) || [])[1],
  },
  openai: {
    base: 'https://api.openai.com',
    key: () => process.env.OPENAI_API_KEY,
    inject: (headers, key) => { headers.set('authorization', `Bearer ${key}`); },
    modelFromBody: true, // model is in the JSON body
  },
  anthropic: {
    base: 'https://api.anthropic.com',
    key: () => process.env.ANTHROPIC_API_KEY,
    inject: (headers, key) => {
      headers.set('x-api-key', key);
      if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    },
    modelFromBody: true,
  },
};

// --- usage extraction (Phase 4 metering) -----------------------------------
// The vendors report token usage in their (streamed) responses. We buffer a
// copy of the response body and scan it for the token counts. Best-effort: if
// nothing is found we simply don't record a row.
function lastInt(pattern, text) {
  const re = new RegExp(pattern, 'g');
  let m, val = null;
  while ((m = re.exec(text))) val = parseInt(m[1], 10);
  return val;
}
function firstInt(pattern, text) {
  const m = text.match(new RegExp(pattern));
  return m ? parseInt(m[1], 10) : null;
}
const USAGE_EXTRACTORS = {
  // google: usageMetadata.{promptTokenCount,candidatesTokenCount}, last chunk wins
  google: (t) => ({ input: lastInt('"promptTokenCount"\\s*:\\s*(\\d+)', t), output: lastInt('"candidatesTokenCount"\\s*:\\s*(\\d+)', t) }),
  // openai: usage.{prompt_tokens,completion_tokens} (needs stream_options.include_usage)
  openai: (t) => ({ input: lastInt('"prompt_tokens"\\s*:\\s*(\\d+)', t), output: lastInt('"completion_tokens"\\s*:\\s*(\\d+)', t) }),
  // anthropic: input_tokens in message_start (first), output_tokens accumulates in message_delta (last)
  anthropic: (t) => ({ input: firstInt('"input_tokens"\\s*:\\s*(\\d+)', t), output: lastInt('"output_tokens"\\s*:\\s*(\\d+)', t) }),
};

async function reportUsage({ vendorName, grantToken, requestId, text }) {
  if (!BACKEND_URL) return; // metering disabled
  const extract = USAGE_EXTRACTORS[vendorName];
  if (!extract) return;
  const { input, output } = extract(text) || {};
  const inputTokens = input || 0;
  const outputTokens = output || 0;
  if (!inputTokens && !outputTokens) return; // nothing to record
  try {
    // Self-signed SERVICE token (authn to the backend); usage attribution comes
    // from the forwarded grant, not from us.
    const serviceToken = jwt.sign({ typ: 'service', sub: 'ai-gateway' }, SECRET, { algorithm: ALGORITHM, expiresIn: 300 });
    const r = await fetch(`${BACKEND_URL}/internal/ai/usage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ grant: grantToken, request_id: requestId, input_tokens: inputTokens, output_tokens: outputTokens }),
    });
    if (!r.ok) console.error(`[ai-gateway] usage report ${r.status}`);
  } catch (e) {
    console.error('[ai-gateway] usage report failed:', e.message);
  }
}

// Headers we must never forward upstream (hop-by-hop or caller-supplied auth /
// the dummy key the AI SDK sends). Everything else (content-type, accept, the
// provider's own protocol headers) is preserved so streaming/SSE still works.
const STRIP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'content-length', 'x-ai-grant',
  'authorization', 'x-goog-api-key', 'x-api-key', 'accept-encoding',
]);

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/healthz') return send(res, 200, { ok: true });

    // Path shape: /<vendor>/<...vendor-native-path>
    const segments = url.pathname.replace(/^\/+/, '').split('/');
    const vendorName = segments.shift();
    const vendor = VENDORS[vendorName];
    if (!vendor) return send(res, 404, { error: `Unknown vendor '${vendorName}'` });

    // 1. Verify the grant.
    const grantToken = req.headers['x-ai-grant'];
    if (!grantToken) return send(res, 401, { error: 'Missing x-ai-grant' });
    let grant;
    try {
      grant = jwt.verify(grantToken, SECRET, { algorithms: [ALGORITHM] });
    } catch (e) {
      return send(res, 401, { error: `Invalid or expired grant: ${e.message}` });
    }
    if (grant.typ !== GRANT_TYPE) return send(res, 401, { error: 'Wrong token type' });

    // 2. Grant must authorize THIS vendor.
    if (grant.vendor !== vendorName) {
      return send(res, 403, { error: `Grant is for '${grant.vendor}', not '${vendorName}'` });
    }

    // Buffer the body (prompts are small); needed both to forward and to check
    // the requested model for body-carried vendors.
    const bodyBuf = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);

    // 3. Enforce the requested model matches the grant (defense in depth).
    let requestedModel;
    const upstreamPath = '/' + segments.join('/');
    if (vendor.modelFromPath) {
      requestedModel = vendor.modelFromPath(upstreamPath);
    } else if (vendor.modelFromBody && bodyBuf && bodyBuf.length) {
      try { requestedModel = JSON.parse(bodyBuf.toString('utf8')).model; } catch { /* ignore */ }
    }
    if (requestedModel && grant.model && requestedModel !== grant.model) {
      return send(res, 403, { error: `Model '${requestedModel}' not permitted by grant ('${grant.model}')` });
    }

    // 4. Real vendor key.
    const apiKey = vendor.key();
    if (!apiKey) return send(res, 502, { error: `No API key configured for vendor '${vendorName}'` });

    // Build the upstream request: preserve path + query, strip caller headers,
    // inject the vendor key.
    const target = vendor.base + upstreamPath + url.search;
    const outHeaders = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase())) outHeaders.set(k, Array.isArray(v) ? v.join(',') : v);
    }
    vendor.inject(outHeaders, apiKey);

    const upstream = await fetch(target, {
      method: req.method,
      headers: outHeaders,
      body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
      // let the SDK/vendor manage keep-alive; we stream the response through
    });

    // Relay status + safe headers, then STREAM the body straight through so
    // token deltas / SSE reach the editor live (no buffering).
    const respHeaders = {};
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (k === 'content-encoding' || k === 'content-length' || k === 'transfer-encoding' || k === 'connection') return;
      respHeaders[key] = value;
    });
    respHeaders['x-accel-buffering'] = 'no'; // disable proxy buffering (nginx etc.)
    res.writeHead(upstream.status, respHeaders);

    if (upstream.body) {
      // Tee: stream to the client AND accumulate a copy to extract token usage
      // once the stream finishes. Accumulation never delays the client.
      const requestId = randomUUID();
      const nodeStream = Readable.fromWeb(upstream.body);
      const decoder = new TextDecoder();
      let buf = '';
      let capped = false;
      nodeStream.on('data', (chunk) => {
        if (!capped && buf.length < USAGE_SCAN_CAP) {
          buf += decoder.decode(chunk, { stream: true });
          if (buf.length >= USAGE_SCAN_CAP) capped = true;
        }
      });
      nodeStream.on('end', () => {
        if (upstream.ok) {
          reportUsage({ vendorName, grantToken, requestId, text: buf }).catch(() => {});
        }
      });
      nodeStream.on('error', () => { /* client aborts etc. — nothing to meter */ });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[ai-gateway] error:', err);
    if (!res.headersSent) send(res, 500, { error: 'Gateway error' });
    else res.end();
  }
});

server.listen(PORT, () => {
  const enabled = Object.keys(VENDORS).filter((v) => VENDORS[v].key());
  console.log(`[ai-gateway] listening on :${PORT} — vendors with keys: ${enabled.join(', ') || '(none)'}`);
});
