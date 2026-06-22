"""
Tests the P2 auth-hardening changes:
  - email is CASE-INSENSITIVE on signup + login (mirrors the lower(email) index)
  - a different-case duplicate signup -> clean 409 (not a 500 from the DB index)
  - access token lifetime honours ACCESS_TOKEN_EXPIRE_MINUTES (short, ~60m)
  - refresh-token pruning deletes EXPIRED rows on login but KEEPS revoked-but-
    unexpired rows (so reuse-detection still works)

Needs the server up AND direct DB access (DATABASE_URL).  python test_auth_session.py
"""
import sys
import uuid
import base64
import json
import asyncio
import os
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BASE = "http://127.0.0.1:8000/api"
ORG_ID = os.environ.get("DEFAULT_ORG_ID", "00000000-0000-0000-0000-000000000001")
_fail = []


def check(name, ok, extra=""):
    print(f"  [{'OK ' if ok else 'XX '}] {name}" + (f"  -> {extra}" if extra else ""))
    if not ok:
        _fail.append(name)


def jwt_exp_minutes(token: str) -> float:
    """Decode (without verifying) a JWT and return minutes until exp."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)  # pad base64
    data = json.loads(base64.urlsafe_b64decode(payload))
    return (datetime.fromtimestamp(data["exp"], tz=timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 60


async def _db_exec(sql, params=None):
    eng = create_async_engine(os.environ["DATABASE_URL"])
    async with eng.begin() as c:
        res = await c.execute(text(sql), params or {})
        rows = res.fetchall() if res.returns_rows else None
    await eng.dispose()
    return rows


def main():
    suffix = uuid.uuid4().hex[:8]
    mixed = f"Case_{suffix}@T.com"          # signup with mixed case
    lower = mixed.lower()
    upper = mixed.upper()
    pw = "secret123"

    with httpx.Client(base_url=BASE, timeout=25) as c:
        print("[email case-insensitivity]")
        r = c.post("/auth/signup", json={"email": mixed, "password": pw, "display_name": "Case"})
        check("signup mixed-case -> 201", r.status_code == 201, r.status_code)
        uid_ = r.json()["user"]["id"] if r.status_code == 201 else None
        check("stored email is lowercased", r.json()["user"]["email"] == lower if r.status_code == 201 else False)

        check("login lower-case -> 200", c.post("/auth/login", json={"email": lower, "password": pw}).status_code == 200)
        check("login UPPER-case -> 200", c.post("/auth/login", json={"email": upper, "password": pw}).status_code == 200)

        r = c.post("/auth/signup", json={"email": upper, "password": pw, "display_name": "Dup"})
        check("different-case duplicate signup -> 409 (not 500)", r.status_code == 409, r.status_code)

        print("\n[access token lifetime]")
        tok = c.post("/auth/login", json={"email": lower, "password": pw}).json()["token"]
        mins = jwt_exp_minutes(tok)
        check("access token expiry ~60min (ACCESS_TOKEN_EXPIRE_MINUTES)", 50 <= mins <= 70, round(mins, 1))

    # ---- pruning (DB-backed) ----
    print("\n[refresh-token pruning]")
    async def prune_checks():
        # seed one EXPIRED token and one REVOKED-but-UNEXPIRED token for the user
        await _db_exec(
            "INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, revoked) "
            "VALUES (:id, :org, :uid, :h, :exp, false)",
            {"id": str(uuid.uuid4()), "org": ORG_ID, "uid": uid_, "h": "expired_" + suffix,
             "exp": datetime.now(timezone.utc) - timedelta(days=1)},
        )
        await _db_exec(
            "INSERT INTO refresh_tokens (id, org_id, user_id, token_hash, expires_at, revoked) "
            "VALUES (:id, :org, :uid, :h, :exp, true)",
            {"id": str(uuid.uuid4()), "org": ORG_ID, "uid": uid_, "h": "revoked_live_" + suffix,
             "exp": datetime.now(timezone.utc) + timedelta(days=10)},
        )
        # a login triggers prune_user_tokens for this user
        with httpx.Client(base_url=BASE, timeout=25) as c:
            c.post("/auth/login", json={"email": lower, "password": pw})
        expired = (await _db_exec(
            "SELECT count(*) FROM refresh_tokens WHERE user_id=:u AND expires_at <= now()", {"u": uid_}))[0][0]
        revoked_live = (await _db_exec(
            "SELECT count(*) FROM refresh_tokens WHERE user_id=:u AND revoked=true AND expires_at > now()", {"u": uid_}))[0][0]
        return expired, revoked_live

    expired, revoked_live = asyncio.run(prune_checks())
    check("expired tokens pruned on login (0 remain)", expired == 0, expired)
    check("revoked-but-unexpired tokens KEPT (reuse-detection intact)", revoked_live >= 1, revoked_live)

    print("\n" + "=" * 56)
    if _fail:
        print("FAILED:", ", ".join(_fail)); print("=" * 56); sys.exit(1)
    print("ALL AUTH-SESSION (P2) CHECKS PASSED"); print("=" * 56)


if __name__ == "__main__":
    main()
