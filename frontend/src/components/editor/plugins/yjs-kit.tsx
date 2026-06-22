'use client';

import { YjsPlugin } from '@platejs/yjs/react';

import { getToken } from '@/lib/api/client';

const COLLAB_URL =
  process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234';

/**
 * Build the YjsPlugin for a specific document.
 * Call inside usePlateEditor — the component must be client-side only.
 *
 * The Hocuspocus provider's `token` is passed as a FUNCTION (not a static
 * string): the provider invokes it on every (re)connect, so it always reads the
 * CURRENT access token from storage. This matters now that access tokens are
 * short-lived (~60m) and rotated by the REST refresh flow — a reconnect after a
 * rotation picks up the fresh token instead of failing auth with a stale one.
 *
 * @param docId - document UUID, used as the Hocuspocus document name
 */
export function createYjsPlugin(docId: string) {
  return YjsPlugin.configure({
    options: {
      providers: [
        {
          type: 'hocuspocus' as const,
          options: {
            url: COLLAB_URL,
            name: docId,
            token: () => getToken() ?? '',
          },
        },
      ],
    },
  });
}
