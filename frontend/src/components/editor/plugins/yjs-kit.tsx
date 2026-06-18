'use client';

import { YjsPlugin } from '@platejs/yjs/react';

const COLLAB_URL =
  process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:1234';

/**
 * Build the YjsPlugin for a specific document + authenticated user.
 * Call inside usePlateEditor — the component must be client-side only.
 *
 * @param docId  - document UUID, used as the Hocuspocus document name
 * @param token  - JWT from localStorage (same token the REST API uses)
 */
export function createYjsPlugin(docId: string, token: string) {
  return YjsPlugin.configure({
    options: {
      providers: [
        {
          type: 'hocuspocus' as const,
          options: {
            url: COLLAB_URL,
            name: docId,
            token,
          },
        },
      ],
    },
  });
}
