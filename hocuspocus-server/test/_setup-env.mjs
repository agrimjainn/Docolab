// test/_setup-env.mjs
// Side-effect module: pin JWT_SECRET BEFORE auth.js is evaluated.
// auth.js reads process.env.JWT_SECRET at import time, and ESM evaluates
// imported modules in source order — so importing this first makes the secret
// deterministic for tests that exercise the real verifyToken().
process.env.JWT_SECRET = "test-secret-deterministic";
export const JWT_SECRET = process.env.JWT_SECRET;
