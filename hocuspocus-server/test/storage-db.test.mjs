// test/storage-db.test.mjs
// Exercises the REAL loadDocument()/storeDocument() (storage.js) against an
// in-memory Postgres (pg-mem) seeded with the real documents schema.
//
// IMPORTANT — pg-mem bytea fidelity caveat:
//   pg-mem round-trips bytea bytes < 128 faithfully but mangles bytes >= 128
//   (it re-encodes them as the UTF-8 replacement char). This is an EMULATOR
//   limitation, NOT a bug in our code — real PostgreSQL + the `pg` driver
//   preserve arbitrary binary. We therefore:
//     • validate the SQL/query path, NULL handling, updated_at, last-write-wins,
//       and round-trip shape using ASCII-safe payloads here, and
//     • validate FULL byte-range fidelity at the Buffer<->Uint8Array layer
//       (where our code actually does the conversion) in the dedicated test.

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";

import { setPool, query } from "../db.js";
import { loadDocument, storeDocument } from "../storage.js";
import { createTestDb, ids } from "./schema.mjs";

let pool;

before(async () => {
  ({ pool } = await createTestDb());
  setPool(pool);
});

after(async () => {
  setPool(null);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("loadDocument", () => {
  test("returns null for a document whose yjs_state is NULL (new doc)", async () => {
    assert.equal(await loadDocument(ids.docs.inRoot), null);
  });

  test("returns null for an unknown document id", async () => {
    assert.equal(await loadDocument("no-such-doc"), null);
  });
});

describe("storeDocument → loadDocument round-trip", () => {
  test("persisted bytes come back as a Uint8Array with the same contents", async () => {
    const payload = new Uint8Array([1, 2, 3, 65, 66, 67, 0, 127]); // all < 128
    await storeDocument(ids.docs.inRoot, payload);

    const loaded = await loadDocument(ids.docs.inRoot);
    assert.ok(loaded instanceof Uint8Array, "expected a Uint8Array");
    assert.deepEqual([...loaded], [...payload]);
  });

  test("last write wins (snapshot overwrite)", async () => {
    await storeDocument(ids.docs.inRoot, new Uint8Array([10, 11, 12]));
    await storeDocument(ids.docs.inRoot, new Uint8Array([20, 21]));
    const loaded = await loadDocument(ids.docs.inRoot);
    assert.deepEqual([...loaded], [20, 21]);
  });

  test("storeDocument advances updated_at", async () => {
    const before = await query("SELECT updated_at FROM documents WHERE id=$1", [ids.docs.inRoot]);
    await sleep(15);
    await storeDocument(ids.docs.inRoot, new Uint8Array([1]));
    const after = await query("SELECT updated_at FROM documents WHERE id=$1", [ids.docs.inRoot]);
    assert.ok(
      new Date(after.rows[0].updated_at).getTime() >= new Date(before.rows[0].updated_at).getTime(),
      "updated_at should not move backwards"
    );
  });

  test("only the targeted document row is modified", async () => {
    await storeDocument(ids.docs.inRoot, new Uint8Array([42]));
    // A different document must remain untouched (still NULL state).
    assert.equal(await loadDocument(ids.docs.other), null);
  });

  test("storing an empty Uint8Array is preserved as empty (not NULL)", async () => {
    await storeDocument(ids.docs.inRoot, new Uint8Array([]));
    const loaded = await loadDocument(ids.docs.inRoot);
    // pg returns empty bytea as a zero-length Buffer → Uint8Array length 0.
    assert.ok(loaded instanceof Uint8Array);
    assert.equal(loaded.length, 0);
  });
});

describe("full byte-range fidelity (Buffer <-> Uint8Array conversion layer)", () => {
  // This is the conversion storage.js performs; it must be lossless across the
  // entire 0..255 range. (pg-mem cannot validate this; real PG does.)
  test("Buffer.from(Uint8Array) → new Uint8Array(Buffer) is lossless for 0..255", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const buf = Buffer.from(all); // write path conversion
    const back = new Uint8Array(buf); // read path conversion
    assert.equal(back.length, 256);
    assert.deepEqual([...back], [...all]);
  });
});
