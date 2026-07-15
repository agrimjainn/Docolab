"""Phase 4 smoke: AI usage metering round-trip (service JWT + grant + aggregation).

Run: python test_ai_usage_smoke.py   (requires the dev Postgres to be up)
Creates two throwaway documents, reports usage against them through the internal
endpoint exactly as the gateway would, then reads the admin aggregations. Cleans
up after itself.
"""
import asyncio
import uuid

from sqlalchemy import select, delete
from starlette.testclient import TestClient

import app.main as m
from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token
from app.models.database_models import User, Document, Assignment, Role, AiUsageEvent, Folder
from app.services.ai_grant_service import issue_grant, issue_service_token

created_doc_ids = []
created_req_ids = []


async def setup():
    async with AsyncSessionLocal() as db:
        # bootstrap admin = a user holding an org-scoped 'owner' assignment
        row = (await db.execute(
            select(User).join(Assignment, Assignment.user_id == User.id)
            .join(Role, Role.id == Assignment.role_id)
            .where(Assignment.scope_type == "org", Role.name == "owner")
        )).scalars().first()
        assert row, "no org-admin found (seed did not run?)"
        admin = row
        # live DB enforces documents.folder_id NOT NULL — use any org folder
        folder = (await db.execute(select(Folder).where(Folder.org_id == admin.org_id))).scalars().first()
        assert folder, "no folder in org to park smoke docs under"
        docs = []
        for title, model in [("SMOKE Doc A", "gemini-2.5-flash"), ("SMOKE Doc B", "gemini-2.5-flash")]:
            d = Document(
                id=uuid.uuid4(), org_id=admin.org_id, folder_id=folder.id, title=title,
                yjs_doc_key=f"smoke-{uuid.uuid4()}", created_by=admin.id, ai_model=model,
            )
            db.add(d)
            docs.append(d)
        await db.commit()
        for d in docs:
            await db.refresh(d)
            created_doc_ids.append(d.id)
        return str(admin.id), str(admin.org_id), [str(d.id) for d in docs]


async def cleanup():
    async with AsyncSessionLocal() as db:
        if created_req_ids:
            await db.execute(delete(AiUsageEvent).where(AiUsageEvent.request_id.in_(created_req_ids)))
        for did in created_doc_ids:
            await db.execute(delete(Document).where(Document.id == did))
        await db.commit()


def main():
    admin_id, org_id, doc_ids = asyncio.run(setup())
    doc_a, doc_b = doc_ids
    service_token = issue_service_token()
    ok = True

    with TestClient(m.app) as c:
        # --- report usage for doc A (two calls) and doc B (one) ---
        def report(doc, inp, out):
            g = issue_grant(user_id=admin_id, org_id=org_id, document_id=doc,
                            vendor="google", model_key="gemini-2.5-flash")
            rid = f"smoke-{uuid.uuid4()}"
            created_req_ids.append(rid)
            r = c.post("/api/internal/ai/usage",
                       headers={"Authorization": f"Bearer {service_token}"},
                       json={"grant": g, "request_id": rid, "input_tokens": inp, "output_tokens": out})
            return r, rid, g

        r1, rid1, g1 = report(doc_a, 100, 40)   # doc A: 140
        r2, _,   _  = report(doc_a, 60, 20)     # doc A: +80 => 220
        r3, _,   _  = report(doc_b, 10, 5)      # doc B: 15
        print("report A1:", r1.status_code, r1.json())
        print("report A2:", r2.status_code, r2.json())
        print("report B :", r3.status_code, r3.json())
        ok &= r1.status_code == 200 and r1.json()["recorded"] is True

        # --- idempotency: replay rid1 => recorded False ---
        replay = c.post("/api/internal/ai/usage",
                        headers={"Authorization": f"Bearer {service_token}"},
                        json={"grant": g1, "request_id": rid1, "input_tokens": 100, "output_tokens": 40})
        print("idempotent replay:", replay.status_code, replay.json())
        ok &= replay.status_code == 200 and replay.json()["recorded"] is False

        # --- auth failures ---
        no_auth = c.post("/api/internal/ai/usage", json={"grant": g1, "request_id": "x", "input_tokens": 1})
        print("no service token:", no_auth.status_code)
        ok &= no_auth.status_code == 401

        user_tok = create_access_token(subject=admin_id)  # a normal access token, wrong typ
        wrong = c.post("/api/internal/ai/usage",
                       headers={"Authorization": f"Bearer {user_tok}"},
                       json={"grant": g1, "request_id": "x", "input_tokens": 1})
        print("user token as service:", wrong.status_code)
        ok &= wrong.status_code == 401

        bad_grant = c.post("/api/internal/ai/usage",
                           headers={"Authorization": f"Bearer {service_token}"},
                           json={"grant": g1 + "tamper", "request_id": "x", "input_tokens": 1})
        print("tampered grant:", bad_grant.status_code)
        ok &= bad_grant.status_code == 400

        # --- aggregations (admin) ---
        admin_bearer = create_access_token(subject=admin_id)
        bym = c.get("/api/admin/ai/usage/by-model", headers={"Authorization": f"Bearer {admin_bearer}"})
        byd = c.get("/api/admin/ai/usage/by-document?limit=5", headers={"Authorization": f"Bearer {admin_bearer}"})
        print("by-model:", bym.status_code, bym.json())
        print("by-document:", byd.status_code, byd.json())
        ok &= bym.status_code == 200 and byd.status_code == 200
        # our two docs should be present and doc A (220) ranks above doc B (15)
        titles = [d.get("title") for d in byd.json()["documents"]]
        ok &= "SMOKE Doc A" in titles and "SMOKE Doc B" in titles
        ia = titles.index("SMOKE Doc A"); ib = titles.index("SMOKE Doc B")
        ok &= ia < ib

    asyncio.run(cleanup())
    print("\nSMOKE_RESULT:", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    main()
