// hocuspocus-server/db.js
// Thin PostgreSQL connection pool. Reads DATABASE_URL from .env (same as FastAPI).
//
// The pool is created lazily and can be replaced via setPool() so tests can
// inject an in-memory engine (pg-mem) without a live database. Production
// behaviour is unchanged: the first query() builds the real pg Pool.

import pg from "pg";

const { Pool } = pg;

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/docplatform",
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err.message);
    });
  }
  return pool;
}

/** Replace the pool (tests inject pg-mem here). Pass null to reset. */
export function setPool(injected) {
  pool = injected;
}

export async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export default { getPool, setPool, query };
