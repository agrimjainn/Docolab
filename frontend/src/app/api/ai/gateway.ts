// =============================================================================
// app/api/ai/gateway.ts
//
// Server-side helper the Next AI routes use to run model calls through the
// backend-governed AI gateway instead of a local vendor key.
//
// Flow: the route hands us { documentId, token }. We call the backend
// `POST /documents/{id}/ai/grant`, which authorizes the user, resolves the
// document's admin-assigned model, and returns { vendor, model_key, grant,
// gateway_url }. We build the matching AI-SDK provider pointed at the gateway,
// passing the signed grant as `x-ai-grant` INSTEAD of a vendor key. The gateway
// verifies the grant and injects the real key.
//
// Returns null when the gateway isn't configured or the caller didn't supply a
// doc/token — the routes then fall back to their legacy env-key path so local
// dev keeps working before the gateway is deployed.
// =============================================================================

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export interface GatewayProvider {
  /** Governed model factory. Ignores any per-step model id the caller passes —
   *  the model is decided by the backend, not the client. */
  model: (id?: string) => LanguageModel;
  vendor: string;
  modelKey: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export async function getGatewayProvider(opts: {
  documentId?: string;
  token?: string;
  signal?: AbortSignal;
}): Promise<GatewayProvider | null> {
  const { documentId, token, signal } = opts;
  if (!documentId || !token) return null;

  let data: any;
  try {
    const res = await fetch(`${API_BASE}/documents/${documentId}/ai/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal,
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const gatewayUrl: string = data?.gateway_url;
  const grant: string = data?.grant;
  const vendor: string = data?.vendor;
  const modelKey: string = data?.model_key;
  if (!gatewayUrl || !grant || !vendor || !modelKey) return null;

  const headers = { 'x-ai-grant': grant };

  if (vendor === 'google') {
    const google = createGoogleGenerativeAI({
      apiKey: 'via-gateway', // dummy — the gateway injects the real key
      baseURL: `${gatewayUrl}/google/v1beta`,
      headers,
    });
    return { model: () => google(modelKey), vendor, modelKey };
  }

  // openai / anthropic: optional provider packages. Loaded via a non-literal
  // specifier so the build doesn't require them until you actually add them
  // (`npm i @ai-sdk/openai @ai-sdk/anthropic`) and enable the vendor in the
  // org catalog.
  if (vendor === 'openai') {
    try {
      const pkg = '@ai-sdk/openai';
      const { createOpenAI } = await import(pkg);
      const openai = createOpenAI({ apiKey: 'via-gateway', baseURL: `${gatewayUrl}/openai/v1`, headers });
      return { model: () => openai(modelKey), vendor, modelKey };
    } catch {
      return null;
    }
  }
  if (vendor === 'anthropic') {
    try {
      const pkg = '@ai-sdk/anthropic';
      const { createAnthropic } = await import(pkg);
      const anthropic = createAnthropic({ apiKey: 'via-gateway', baseURL: `${gatewayUrl}/anthropic/v1`, headers });
      return { model: () => anthropic(modelKey), vendor, modelKey };
    } catch {
      return null;
    }
  }
  return null;
}
