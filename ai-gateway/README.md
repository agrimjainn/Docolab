# ai-gateway

Grant-verifying, key-injecting reverse proxy in front of the AI vendors. Keeps
vendor API keys **off the frontend** while preserving the editor's streaming and
tool-calling (the Vercel AI SDK still speaks its native protocol end-to-end).

## Flow

```
Editor (Plate) ──► Next AI route ──► ai-gateway ──► Vendor (Gemini/OpenAI/Anthropic)
                        │  x-ai-grant: <signed JWT>      ▲
                        │  (NO vendor key)               │ real key injected here
   backend mints grant ─┘                                │ (only place keys live)
```

1. Frontend calls backend `POST /api/documents/{id}/ai/grant` → gets a short-lived
   signed grant + the resolved `{vendor, model_key}` + `gateway_url`.
2. The Next AI route builds the AI-SDK provider with `baseURL = <gateway>/<vendor>/...`
   and header `x-ai-grant: <grant>` (dummy apiKey).
3. Gateway verifies the grant (HMAC + expiry, `AI_GATEWAY_SECRET` shared with the
   backend), checks vendor + model match the grant, strips caller headers, injects
   the **real** vendor key, forwards, and streams the response straight back.

## Run

```bash
cd ai-gateway
cp .env.example .env      # set AI_GATEWAY_SECRET (= backend) + vendor keys
npm install
npm run dev               # http://localhost:8787  (GET /healthz -> {ok:true})
```

## Backend / frontend env

- backend `.env`: `AI_GATEWAY_URL=http://localhost:8787`, `AI_GATEWAY_SECRET=<same>`
- frontend: no vendor key needed anymore; the gateway holds them.

## Add a vendor

Add an entry to `VENDORS` in `server.js` (upstream base, `key()`, `inject()`,
and how to read the model) and set its API-key env var. Enable the model in the
org catalog via the Admin page.

## Security notes

- Grants are single-purpose, seconds-long, and scoped to user+doc+vendor+model.
- The real keys never leave this service; a leaked grant can't be forged and
  expires almost immediately.
- Runs server-to-server (called by the Next route, not the browser) — no CORS.
