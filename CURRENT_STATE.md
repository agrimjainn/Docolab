# Docolab — Current State of the Project

Single source of truth for where the codebase stands now (backend + frontend), what each part does, what changed most recently, and what still needs fixing.

---

## 1. Overview

Docolab is a collaborative documentation platform: a **Plate/Slate editor** frontend (Next.js) over a **FastAPI + async SQLAlchemy + PostgreSQL** backend, with RBAC, suggestion/comment review, versioning + **multi-step approval**, an **audit trail**, real **sessions** (refresh tokens), and an AI suggestion layer. v1 is a **single shared org** (one team/tenant); `org_id` is on every table as the multi-tenant hook.

**One line:** the backend (60 operations) is async, fully **RBAC-enforced and audited**, with a **dynamic multi-step approval chain** (now **snapshotted at submit**), an **org-admin** role, **real refresh-token sessions**, and **personal bookmarks** — validated end-to-end against Postgres (clean-state run + from-scratch migration + downgrade/upgrade reversibility). The frontend is a Plate editor on a mix of real-backend + MSW/localStorage mocks. Live real-time collab (Hocuspocus/Yjs) and other Tier-2 pieces (S3, AI worker, content diff) are still stubs.

---

## 2. Backend

### Stack
FastAPI · async SQLAlchemy 2.0 (asyncpg) · PostgreSQL · Pydantic v2 · JWT · passlib/bcrypt · Alembic. CORS on; `.env` loaded at startup; on startup the app **runs `alembic upgrade head` in-process** (Alembic is the single source of truth — no more `create_all`) then seeds the single org (roles + admin owner + root folder + org-admin grant).

### Database — 20 tables (+ `alembic_version`), head migration `0004`
Migration `0004_auth_stars_trash` is the v2 schema delta:

| Change | Table / column | Purpose |
|---|---|---|
| **+ table** | `refresh_tokens` | real, revocable sessions (hash-only, rotation, reuse-detection) |
| **+ table** | `document_stars` (user_id, document_id) | **personal** bookmarks (per-user) |
| **− column** | `documents.starred` (dropped) | was a *global* flag — wrong semantics; replaced by `document_stars` |
| **+ column** | `documents.trashed_at` | when a doc entered the reversible recycle bin |
| **+ column** | `versions.approval_policy_id` | **policy snapshot taken at submit** (deterministic in-flight approval) |

Earlier deltas: `0002` (documents.trashed, comments.is_resolved), `0003` (documents.yjs_state).

> **Alembic fix (why `alembic upgrade head` did nothing before):** Alembic's `alembic_version.version_num` column is `VARCHAR(32)`. Migration `0002`'s old revision id `0002_add_starred_trashed_is_resolved` was **36 chars** — Alembic applied the DDL then failed writing the version row (`value too long for type character varying(32)`), so the whole transaction **rolled back** and the DB stayed stuck at `0001` looking untouched. All revision ids are now ≤32 chars, and `create_all` (which masked migrations and caused drift) was removed in favour of in-process `alembic upgrade head` on startup.

### API surface — 60 operations (no route conflicts)
Auth (incl. **real refresh/logout**) · Users · Roles/Assignments · Folders · Documents (incl. **personal star**, trash/restore) · Suggestions · Comments (incl. resolve) · Recommendations · Versions/Approval (**policy snapshot**) · Approval Policies · Audit (per-doc + org-wide) · Ownership · AI · Export · Notifications.

New/changed this round:
- `PUT /documents/{id}/star`, `DELETE /documents/{id}/star` — **personal** bookmark add/remove (only needs read access).
- `GET /documents` — `folder_id` now **optional** (org-wide list); `?starred=true` (my bookmarks), `?trashed=true` (recycle bin).
- `POST /auth/refresh` — **real rotation** (new access + new refresh token; old one revoked; reuse → 401 + family revoke).
- `POST /auth/logout` — **real** server-side revoke of the presented refresh token.
- `POST /auth/signup` & `/login` now also return `refresh_token` (additive — existing clients ignore it).

### Cross-cutting behaviour
- **Async everywhere**; **single-org** signup; **creator-owns** on create.
- **RBAC (one choke-point):** `auth_service.resolve_role()` does the scope walk (document → folder → parents; `org` terminal); `authorize()` checks a permission; **`require_permission()`** is the single guard every mutating endpoint calls. Permissions are data in `role_permissions`.
- **Sessions:** access token = short-lived JWT (24h, unchanged). Refresh token = **opaque, random, stored only as a SHA-256 hash**. Every `/auth/refresh` **rotates** (revoke old, issue new). Reusing a rotated/revoked token revokes the user's whole token family (theft mitigation). `/auth/logout` revokes one token. Lives in `token_service.py`.
- **Personal bookmarks:** stars are per-user (`document_stars`). One person starring a doc does **not** star it for everyone, and a **viewer can bookmark a read-only doc** (star needs only `can_view_history`, not edit rights). Document responses carry a computed `starred` = "starred by me".
- **Trash vs delete (one model):** `trashed`=**reversible recycle bin** (`PATCH {"trashed": true/false}`, stamps/clears `trashed_at`); `status="deleted"` via `DELETE`=**permanent** (terminal — `GET` returns 404, hidden from every list incl. the bin). Neither is allowed while a doc is `pending_approval` (409).
- **Org-admin:** explicit **org-scoped** `assignments` row (`scope_type="org"`) with `can_manage_members`; `is_org_admin()` checks it; seeded admin has it. Not inferred from ownership.
- **Audit:** every state-changing endpoint writes an `audit_log` row in the same transaction; updates record **before→after** meta. Append-only. Readable per-document (`can_view_history`) and org-wide (`GET /audit`, org-admin). New actions: `login`, `token_refresh`, `document_trash/restore/star/unstar`.
- **Multi-step approval chain + snapshot:** at **submit**, the document's policy is **snapshotted onto the submission Version** (`versions.approval_policy_id`). The chain (and `approval-status`) resolves against that snapshot, so editing/detaching the policy mid-review can't corrupt an in-flight approval. Each step needs a **role** + `can_approve_level` + a **distinct** approver, with `min_approvals`; the baseline (`approval_markers`) advances only when the final step completes. NULL snapshot == the original single owner gate (byte-for-byte).
- **Ownership transfer:** atomic, audited handover. **Last-owner guard:** `DELETE /assignments` refuses to remove the only owner of a scope.

### What's real vs stubbed
- **Real (Postgres-backed):** auth + **real sessions** (refresh/logout), users, roles, assignments (org scope + last-owner guard), folders, documents (incl. **personal star**, trash/restore, org-filtered list), suggestions, comments (incl. resolve), recommendations, approval policies + **snapshotted** multi-step chain, version/approval bookkeeping, org-wide audit, ownership, RBAC, org-admin.
- **Stubbed (need infra):** S3 blobs + signed URLs, content diff, export serializers, AI worker (`/ai/*` placeholders), notification live-push, and the **Hocuspocus/Yjs live-collaboration + content-persistence server** (Node).

---

## 3. Frontend
Next.js 16 + React 19 + **Plate v53** (suggestions, comments, tables, media, math, AI, …). **AI via Gemini** (its own Next.js API routes), **PDF export**, docx, **MSW** mocks, Playwright. Pages: **login**, **browser**, **editor**. API clients for auth/documents/versions/comments/collaborators/ai/export/notifications. **Auth (login/signup)** and the **versions/approval** cluster call the real backend; most of the rest is localStorage/MSW (see §8).

---

## 4. What changed most recently (v2: alembic fix + auth/sessions + stars/trash + approval snapshot)
1. **Alembic fixed** — revision ids shortened to ≤32 chars (`0002`/`0003` were the blocker); `alembic upgrade head` now reaches `0004`. Startup uses in-process `alembic upgrade head` (single source of truth) instead of `create_all`.
2. **Real refresh-token store** (`refresh_tokens` + `token_service.py`) — opaque + hashed + rotation + reuse-detection; `/auth/refresh` and `/auth/logout` are no longer stubs; signup/login return a refresh token.
3. **Personal bookmarks** — dropped the global `documents.starred`; added `document_stars` + `PUT/DELETE /documents/{id}/star`; starring needs only read access; `?starred=true` lists mine.
4. **Unified trash/delete** — `trashed` = reversible bin (+`trashed_at`), `DELETE` = permanent (`GET`→404); both blocked while pending approval.
5. **Approval policy snapshot at submit** — `versions.approval_policy_id`; chain + `approval-status` resolve against the snapshot.
6. **Filtered/org-wide document list** — `GET /documents` with optional `folder_id` + `?starred`/`?trashed` (unblocks the browser's all/starred/trash views).

DB change: **+2 tables, +2 columns, −1 column** (migration `0004`). New operations: **2** (58 → 60).

---

## 5. End-to-end workflow (v1)
Sign up → join org → create folder (own it) → create docs → suggest/accept/reject + comment/resolve → (optionally attach an approval policy) → **submit (policy snapshotted)** → **chain of role-based approvals** (or single owner gate) → baseline advances → every action in the **audit log** → ownership handover. Org-admins manage members, policies, and read the org-wide audit. Personal stars + the recycle bin organize the browser. Sessions survive via refresh-token rotation. Live multi-user editing + content persistence (Yjs/Hocuspocus + S3 cold-storage snapshots) is the remaining real-time piece (see §8).

---

## 6. Validation status
Validated against the live Postgres (`docplatform`), then **left clean (empty data, schema at head `0004`)**:
- **Clean-state run:** truncated all data, restarted (re-seed), ran **all 8 suites — PASS=8**:
  `test_flow`, `test_new_endpoints`, `test_person_a_endpoints`, `test_rbac_audit`, `test_governance`, `test_auth_tokens` (rotation, reuse-detection, logout), `test_stars_trash` (personal stars, viewer-can-star, recycle bin, permanent delete, pending-approval guards), `test_approval_snapshot` (snapshot survives detach; null snapshot ignores a later-attached policy).
- **From-scratch migration:** on a throwaway DB, `alembic upgrade head` ran `0001→0002→0003→0004` clean; **downgrade to base then re-upgrade** clean (reversible).
- **No route conflicts**; app imports clean; startup auto-migrate is a no-op when already at head.

---

## 7. Known gaps & recommended fixes

### Resolved in this pass ✅
`alembic upgrade head` (revision-id overflow) + `create_all`/alembic drift; refresh-token store (refresh/logout real, rotation, reuse-detection); personal stars (global flag dropped, viewer can star); unified trash vs permanent delete (incl. `GET`→404 and pending-approval guards); approval policy snapshot at submit; org-wide/filtered document list.

### Still open
1. **Document content persistence / live collab** — the editor's Plate content is **not** persisted via REST; it lives in Yjs/Hocuspocus (+ S3 cold-storage snapshots), which is the **Node server** that isn't built. This is the cold-storage snapshot workflow: the live Y.Doc (warm) is snapshotted to cold storage when idle; submit freezes a snapshot; approval advances the baseline. **Fix:** stand up the Hocuspocus/Yjs server (canonical) — `documents.yjs_state` and version `s3_key` are the backend hooks. (A stopgap `GET/PUT /documents/{id}/content` could persist Plate JSON to a column, but would duplicate the Yjs path — not recommended.)
2. **Share links / "anyone with the link"** — frontend `collaborators.ts` models `generalAccess` + link roles; backend only has explicit `assignments`. **Fix:** a `share_links` table (token, document_id, role, expires_at) + endpoints, if link access is wanted.
3. **Role vocabulary mismatch** — frontend uses `commenter`; backend uses `suggester`. Pick one mapping when wiring the share dialog.
4. **OAuth / SSO** — login page has Google/SSO buttons that are demo-only; no backend provider. Needs an OAuth integration (and likely an `identities` table) if real.
5. **Tier-2 infra:** real S3 storage, content diff, export serializers, AI worker, notification push.
6. **Doc sprawl:** several overlapping root docs (`ARCHITECTURE.md`, `PROJECT_STATUS.md`, `INTEGRATION_CHANGES.md`, `ONBOARDING.md`, `CHANGES_FROM_INITIAL_DESIGN.md`, the API-reference docs, this file). The API-reference docs predate the canonical-mount fix and the star/trash/resolve + governance + v2 auth/stars endpoints; consolidate to avoid drift.

---

## 8. Frontend ↔ backend connection audit

What the frontend calls for real vs. what's still local-only, and how to connect it.

### Already wired to the real backend (`apiFetch`)
- **Auth:** `signIn`/`signUp` → `POST /auth/login|signup` (login also has a local `admin/admin` demo short-circuit + demo Google/SSO).
- **Versions/approval:** list / submit-for-approval / approve / reject / restore.
- **Best-effort:** document **create** fires `POST /documents` (non-blocking); `ai/*`, `export`, `notifications` use `apiFetch` (backends are stubs).

### Open-ended (localStorage/MSW only) → how to connect
| Frontend feature | Client | Backend today | How to connect | DB change |
|---|---|---|---|---|
| Browser list / rename / move | `documents.ts` (`listDocuments`, `updateDocument`) | `GET/PATCH /documents` (real) | swap localStorage for `apiFetch`; use **org-wide `GET /documents`** (`folder_id` optional) | none (added) |
| Star / bookmark | `documents.ts` `toggleStar` | `PUT/DELETE /documents/{id}/star` (real, personal) | call star endpoints; read `starred` from the doc | none (added) |
| Trash / restore / delete | `documents.ts` `setTrashed`/`deleteForever` | `PATCH {trashed}` + `?trashed=true`; `DELETE` (real) | wire to PATCH (bin) and DELETE (permanent) | none |
| **Document content** | `documents.ts` (Plate `content`) | **none in REST** (Yjs/S3) | stand up **Hocuspocus/Yjs** server (§7.1) | — |
| Comments / discussions | `comments.ts` | `POST/GET/PATCH /documents/{id}/comments` (real) | map `TDiscussion` ↔ comments; wire `getDiscussions`/`saveDiscussions` | none |
| Sharing / collaborators | `collaborators.ts` | `assignments` + `users` (real) | share dialog → `POST/GET/DELETE /assignments` + `GET /users`; reconcile role names (§7.3) | none for invites |
| General access / share link | `collaborators.ts` | none | `share_links` table + endpoints (§7.2) | new table |
| Presence (live cursors) | `collaborators.ts` `getPresence` | none | Yjs awareness (Node server) | none |
| Sessions (refresh/logout) | `auth.ts` (not wired) | **real now** | store `refresh_token`; on 401 call `POST /auth/refresh`; `signOut` → `POST /auth/logout` | none |

**Net:** the two connection blockers I removed this round were (a) no org-wide/filtered document list and (b) no personal-star endpoints — both now exist, so the browser's all/starred/trash/shared views and the editor's bookmark/trash actions can be wired with no further backend work. The remaining big one is **document content persistence (Yjs/Hocuspocus + S3)**, which is the Node real-time server, not this Python backend.

---

## 9. What actually gets logged to the backend today

Honest answer to "is editing / suggestions / versioning logged?":

- **Logged & wired (reaches Postgres from the UI today):** auth **login / signup / refresh** (sessions), and the **version lifecycle** — `submit-for-approval`, `approve`, `approve_step`, `reject`, `restore` — each writes an `audit_log` row, and the frontend `versions.ts` actually calls these. So the **approval/versioning workflow is logged**.
- **Logged if called, but NOT yet wired from the UI:** everything else the backend audits — folder/document create/update/**trash/restore/delete/star/unstar**, **suggestion create/accept/reject**, **comment create/resolve**, recommendations, role/assignment changes, ownership transfer, policy create/update/attach. The endpoints write audit rows correctly (proven by tests), but the editor/browser don't call most of them yet.
- **`edit_attributions`** (per-region "who changed what"): a row is written **only when a suggestion is accepted** (`POST /suggestions/:id/accept`). Since the frontend doesn't send suggestions yet, none are written in practice, and there is **no GET endpoint** to read this history back.
- **NOT captured at all:**
  - **Raw/live editing (Yjs):** there is no Hocuspocus/Yjs server; `documents.yjs_state` is never written; keystroke-level edits are not persisted or logged anywhere on the backend.
  - **Suggestions & comments made in the Plate editor:** the frontend keeps them in localStorage and does **not** call `POST /documents/:id/suggestions` or `/comments`, so they never reach the backend (and thus aren't logged).
  - **Document content:** never persisted to the backend (no S3 blob, no content column write). `versions.s3_key` is a pointer to nothing yet.

**So:** versioning/approval = logged. Live editing = not logged (no Yjs server). Suggestions = the backend *can* log them, but the UI doesn't send them yet, so today they aren't.

---

## 10. Remaining work / roadmap (what's left to build & connect)

### A. Backend — endpoints that exist but are STUBS (return placeholders)
| Endpoint | What's missing |
|---|---|
| `GET /versions/:id` | real S3 signed URL (returns a fake `s3://` string) |
| `GET /documents/:id/diff` | real Slate/Yjs JSON diff (returns placeholder text) |
| `/documents/:id/ai/suggest`, `/recommendations/:id/ai/apply`, `/ai/jobs/:id` | real AI worker (returns fake job ids) |
| `GET /documents/:id/export`, `GET /versions/:id/export` | real export serializers (returns mock content) |
| `GET /notifications` (+read/read-all) | stored in DB, but no live push delivery |

### B. Backend — services / endpoints NOT built yet
- **Hocuspocus/Yjs live-collaboration + content server (Node)** — the biggest piece. Persists `documents.yjs_state`, drives presence, and produces the S3 cold-storage snapshots that `versions.s3_key` should point at. Without it there is no real editing, content persistence, or live collab.
- **Real S3 storage** for submission/approved blobs (today `s3_key` points at nothing).
- **`GET` edit-attributions** — read the per-region edit history (rows get written on accept but can't be read back).
- **Search** — `GET /documents?q=` or a dedicated search endpoint (frontend search is client-side over localStorage).
- **Share links / general access** — a `share_links` table (token, document_id, role, expires_at) + endpoints, for "anyone with the link".
- **OAuth / SSO** (+ likely an `identities` table) — the login page's Google/SSO buttons are demo-only.
- **Content diff engine** (backs `GET /diff`).

### C. Frontend — wiring left (the backend already exists, just not called)
- Document browser list / rename / move → `GET/PATCH/DELETE /documents`
- Star / bookmark → `PUT/DELETE /documents/:id/star`
- Trash / restore / permanent delete → `PATCH {trashed}` / `DELETE`
- **Suggestions** (Plate plugin) → `POST /documents/:id/suggestions` + `accept`/`reject`  ← required for "suggestions logged"
- Comments / discussions → `/documents/:id/comments` (+ `resolve`)
- Sharing / collaborators → `/assignments` + `/users` (reconcile `commenter`↔`suggester`)
- Sessions → store `refresh_token`, refresh on 401, `signOut` → `POST /auth/logout`

### D. Frontend — needs the Node server first (Section B)
- Live multi-user editing, presence / cursors, and document content persistence (all Yjs/Hocuspocus).

### Priority order (suggested)
1. **Wire the existing real endpoints** from the frontend (Section C) — biggest value for zero new backend code; makes documents/stars/trash/comments/suggestions actually logged.
2. **Hocuspocus/Yjs + S3** (Section B) — unlocks real editing, content persistence, and the cold-storage snapshot workflow.
3. **De-stub** AI worker, export, diff, S3 URLs (Section A).
4. **Share links, OAuth, search, edit-attribution read** as product needs dictate.
