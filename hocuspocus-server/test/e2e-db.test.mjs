// test/e2e-db.test.mjs
// Full-stack end-to-end: real HocuspocusProvider clients ↔ the REAL server.js
// (buildServer) ↔ real auth.js + storage.js ↔ in-memory Postgres (pg-mem).
//
// This is the closest we can get to production without a real database:
//   • Auth runs the real verifyToken + getUserRole SQL against pg-mem (RBAC).
//   • Read-only enforcement comes from the real role → connectionConfig.readOnly.
//   • Sync is real Yjs CRDT traffic over real WebSockets (provider↔server v3).
//   • Persistence calls the real onStoreDocument → storage.js → pg-mem.
//
// Each test gets a fresh pg-mem + server on a unique port for full isolation.

import { JWT_SECRET } from "./_setup-env.mjs"; // must precede server/auth import
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { WebSocket } from "ws";

import { setPool, query } from "../db.js";
import { buildServer } from "../server.js";
import { createTestDb, ids } from "./schema.mjs";

let nextPort = 14100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (sub) => jwt.sign({ sub }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });

// Boot a fresh server on its own pg-mem + port; returns helpers + teardown.
async function harness() {
  const { pool } = await createTestDb();
  setPool(pool);
  const port = nextPort++;
  const server = buildServer({ port, quiet: true });
  await server.listen();

  const clients = [];
  function connect(docId, token) {
    const doc = new Y.Doc();
    let authFailed = false;
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: docId,
      document: doc,
      token,
      WebSocketPolyfill: WebSocket,
      onAuthenticationFailed: () => {
        authFailed = true;
      },
    });
    const handle = { doc, provider, get authFailed() { return authFailed; } };
    clients.push(handle);
    return handle;
  }

  async function teardown() {
    for (const c of clients) {
      try { c.provider.destroy(); } catch {}
    }
    await sleep(50);
    await server.destroy();
    setPool(null);
  }

  return { connect, teardown, port };
}

describe("e2e: real provider ↔ server ↔ auth/storage ↔ pg-mem", () => {
  test("invalid token is rejected by the real onAuthenticate", async () => {
    const h = await harness();
    try {
      const c = h.connect(ids.docs.inChild, "garbage.jwt.token");
      await sleep(500);
      assert.equal(c.authFailed, true);
    } finally {
      await h.teardown();
    }
  });

  test("two editors sync edits over live CRDT", async () => {
    const h = await harness();
    try {
      const a = h.connect(ids.docs.inChild, sign(ids.users.editor));
      const b = h.connect(ids.docs.inChild, sign(ids.users.editor));
      await sleep(500); // both connect & sync the (empty) doc
      a.doc.getText("content").insert(0, "shared edit");
      await sleep(500);
      assert.equal(b.doc.getText("content").toString(), "shared edit");
    } finally {
      await h.teardown();
    }
  });

  test("a user with only a PARENT-folder grant can edit (RBAC inheritance via SQL)", async () => {
    const h = await harness();
    try {
      // user-parent is owner on folder-root; doc lives in folder-child. The real
      // getUserRole SQL must walk up and grant edit (non-viewer → not read-only).
      const a = h.connect(ids.docs.inChild, sign(ids.users.parentOnly));
      const b = h.connect(ids.docs.inChild, sign(ids.users.editor));
      await sleep(500);
      a.doc.getText("content").insert(0, "owner-by-inheritance");
      await sleep(500);
      assert.equal(b.doc.getText("content").toString(), "owner-by-inheritance");
    } finally {
      await h.teardown();
    }
  });

  test("a viewer connection is read-only — its edits are NOT broadcast", async () => {
    const h = await harness();
    try {
      const viewer = h.connect(ids.docs.inChild, sign(ids.users.viewer));
      const editor = h.connect(ids.docs.inChild, sign(ids.users.editor));
      await sleep(500);
      viewer.doc.getText("content").insert(0, "viewer-attempt");
      await sleep(500);
      assert.ok(
        !editor.doc.getText("content").toString().includes("viewer-attempt"),
        "viewer edits must not propagate"
      );
    } finally {
      await h.teardown();
    }
  });

  test("a user with no grant defaults to viewer (read-only)", async () => {
    const h = await harness();
    try {
      const none = h.connect(ids.docs.inChild, sign(ids.users.none));
      const editor = h.connect(ids.docs.inChild, sign(ids.users.editor));
      await sleep(500);
      none.doc.getText("content").insert(0, "nobody-edit");
      await sleep(500);
      assert.ok(!editor.doc.getText("content").toString().includes("nobody-edit"));
    } finally {
      await h.teardown();
    }
  });

  test("an editor's changes are persisted to pg-mem via onStoreDocument", async () => {
    const h = await harness();
    try {
      const a = h.connect(ids.docs.inChild, sign(ids.users.editor));
      await sleep(400);
      a.doc.getText("content").insert(0, "persist me");
      // debounce is 2000ms / maxDebounce 10000ms in server.js — wait it out.
      await sleep(2600);
      const r = await query("SELECT yjs_state FROM documents WHERE id=$1", [ids.docs.inChild]);
      const state = r.rows[0]?.yjs_state;
      assert.ok(state != null, "yjs_state should be persisted");
      assert.ok(state.length > 0, "persisted state should be non-empty");
    } finally {
      await h.teardown();
    }
  });
});
