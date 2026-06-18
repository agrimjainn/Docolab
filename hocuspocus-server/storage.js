// hocuspocus-server/storage.js
// Persist Yjs document state to/from PostgreSQL.
//
// Storage strategy:
//   - The yjs_state column (BYTEA) on the `documents` table holds the full
//     encoded Y.Doc state vector (output of yjs.encodeStateAsUpdate).
//   - On load: read the bytes and apply them to the in-memory Y.Doc.
//   - On store: overwrite with the latest full state.
//
// This is a simple "last write wins" snapshot — sufficient for v1.
// A future improvement would use an append-only updates table for full history.

import { query } from "./db.js";

// ─────────────────────────────────────────────────────────────────────────────
// loadDocument(docId) → Uint8Array | null
// ─────────────────────────────────────────────────────────────────────────────
export async function loadDocument(docId) {
  const result = await query(
    "SELECT yjs_state FROM documents WHERE id = $1 LIMIT 1",
    [docId]
  );
  if (result.rows.length === 0 || !result.rows[0].yjs_state) return null;

  // pg returns BYTEA as a Node.js Buffer — convert to Uint8Array for Yjs
  return new Uint8Array(result.rows[0].yjs_state);
}

// ─────────────────────────────────────────────────────────────────────────────
// storeDocument(docId, state: Uint8Array) → void
// ─────────────────────────────────────────────────────────────────────────────
export async function storeDocument(docId, state) {
  // Convert Uint8Array → Buffer for pg BYTEA parameter
  const buf = Buffer.from(state);
  await query(
    `UPDATE documents
        SET yjs_state = $1, updated_at = NOW()
      WHERE id = $2`,
    [buf, docId]
  );
}
