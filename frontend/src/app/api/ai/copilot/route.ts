import type { NextRequest } from 'next/server';
import type { LanguageModel } from 'ai';

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { NextResponse } from 'next/server';

import { getGatewayProvider } from '../gateway';

export async function POST(req: NextRequest) {
  const {
    apiKey: key,
    documentId,
    model = 'gemini-2.5-flash',
    prompt,
    system,
    token,
  } = await req.json();

  // Preferred: backend-governed gateway (no vendor key on this server).
  const gateway = await getGatewayProvider({
    documentId,
    token,
    signal: req.signal,
  });

  // Fallback: server Gemini key (local dev before the gateway is deployed).
  const apiKey = key || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!gateway && !apiKey) {
    return NextResponse.json(
      { error: 'AI not configured: no gateway grant and no GOOGLE_GENERATIVE_AI_API_KEY.' },
      { status: 401 }
    );
  }

  const google = gateway ? null : createGoogleGenerativeAI({ apiKey: apiKey! });
  const modelId = model.startsWith('gemini') ? model : 'gemini-2.5-flash';
  const languageModel: LanguageModel = gateway ? gateway.model() : google!(modelId);

  try {
    const result = await generateText({
      abortSignal: req.signal,
      maxOutputTokens: 50,
      model: languageModel,
      prompt,
      system,
      temperature: 0.7,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(null, { status: 408 });
    }

    return NextResponse.json(
      { error: 'Failed to process AI request' },
      { status: 500 }
    );
  }
}
