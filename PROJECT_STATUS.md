# Project Status — Docolab (PLATE v2 Architecture)

**Branch:** `feature/governance-integration-fixes`  
**Date:** 2026-06-17  
**Reference:** `Collaborative_Documentation_Platform_PLATE_v2.md`

This document tracks what is built, what is a stub, and what is not started yet,
mapped against the canonical architecture spec section by section.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done — wired to real DB / real backend |
| 🟡 | Stub — endpoint exists but returns placeholder data |
| ❌ | Not started |
| 🔲 | Deferred by design (architecture says "v2 / later") |

---

## 1. Backend — REST API Endpoints

### §9.1 Auth (Identity module)

| Endpoint | Status | Notes |
|---|---|---|
| `POST /auth/signup` | ✅ | Real — hashes password, returns JWT |
| `POST /auth/login` | ✅ | Real — validates password, returns JWT |
| `POST /auth/refresh` | ❌ | Route file exists but refresh token store not implemented |
| `POST /auth/logout` | ❌ | Route file exists but token invalidation not implemented |
| `GET /auth/me` | ✅ | Real — reads user from JWT |

### §9.2 RBAC & Membership

| Endpoint | Status | Notes |
|---|---|---|
| `GET /users` | ✅ | Real — lists org members with role context |
| `PATCH /users/:id` | ✅ | Real — update display name / color / status |
| `GET /roles` | ✅ | Real — lists roles with permission bundles |
| `GET /assignments?scope_type=&scope_id=` | ✅ | Real |
| `POST /assignments` | ✅ | Real — guarded by `can_manage_members` |
| `DELETE /assignments/:id` | ✅ | Real |

### §9.3 Folders & Documents

| Endpoint | Status | Notes |
|---|---|---|
| `GET /folders` | ✅ | Real |
| `POST /folders` | ✅ | Real — auto-grants owner role to creator |
| `PATCH /folders/:id` | ✅ | Real |
| `DELETE /folders/:id` | ✅ | Real |
| `GET /documents?folder_id=` | ✅ | Real — metadata only |
| `POST /documents` | ✅ | Real — auto-grants owner role to creator |
| `GET /documents/:id` | ✅ | Real |
| `PATCH /documents/:id` | ✅ | Real |
| `DELETE /documents/:id` | ✅ | Real — soft delete |

### §9.4 Suggestions (inner loop) — Person A's cluster

| Endpoint | Status | Notes |
|---|---|---|
| `GET /documents/:id/suggestions?status=` | ✅ | Real — async DB, authorize guard |
| `POST /documents/:id/suggestions` | ✅ | Real — shared by human + AI (`origin` field) |
| `POST /suggestions/:id/accept` | ✅ | Real — writes `edit_attributions`, guarded |
| `POST /suggestions/:id/reject` | ✅ | Real — records reason |
| `GET /documents/:id/comments?since=` | ✅ | Real |
| `POST /documents/:id/comments` | ✅ | Real — threaded via `parent_comment_id` |

### §9.5 Versioning & Approval (Chandan's governance cluster)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /documents/:id/versions` | ✅ | Real — DB query |
| `GET /versions/:id` | 🟡 | Stub — returns metadata; S3 signed URL is fake (`s3://signed-url/...`) |
| `POST /documents/:id/submit-for-approval` | ✅ | Real — DB write; S3 snapshot is placeholder |
| `GET /documents/:id/diff?from=&to=` | 🟡 | Stub — placeholder text; real Slate JSON diff not implemented |
| `POST /versions/:id/approve` | ✅ | Real — single-gate + chain-aware; S3 blob is placeholder |
| `POST /versions/:id/reject` | ✅ | Real — records recommendations, discards submission |
| `POST /versions/:id/restore` | ✅ | Real — DB write; `section_id="full"` stopgap for whole-version restore |
| `GET /versions/:id/approval-status` | ❌ | Not implemented — chain progress endpoint (§9.5 NEW) |

### §9.5a Approval Policies — NEW (dynamic chain feature)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /approval-policies` | ❌ | Not started |
| `POST /approval-policies` | ❌ | Not started |
| `PATCH /approval-policies/:id` | ❌ | Not started |
| `PATCH /documents/:id/approval-policy` | ❌ | Not started |

> These 4 endpoints activate the dynamic multi-step approval chain. Without them,
> every document behaves as the original single owner gate (NULL policy), which is
> the current default behavior. The DB tables (`approval_policies`,
> `approval_policy_steps`, `approval_step_events`) exist in the schema.

### §9.6 Recommendations & Response Threads — Person A's cluster

| Endpoint | Status | Notes |
|---|---|---|
| `GET /versions/:id/recommendations` | ✅ | Real |
| `POST /versions/:id/recommendations` | ✅ | Real |
| `PATCH /recommendations/:id` | ✅ | Real — update status |
| `GET /recommendations/:id/responses` | ✅ | Real |
| `POST /recommendations/:id/responses` | ✅ | Real — append-only |

### §9.7 AI Suggestion Layer

| Endpoint | Status | Notes |
|---|---|---|
| `POST /documents/:id/ai/suggest` | 🟡 | Stub — returns fake `job_id`; no real BullMQ queue |
| `POST /recommendations/:id/ai/apply` | 🟡 | Stub — queues nothing; placeholder response |
| `GET /ai/jobs/:job_id` | 🟡 | Stub — always returns `"completed"` |

### §9.8 Notifications

| Endpoint | Status | Notes |
|---|---|---|
| `GET /notifications?unread=true` | ✅ | Real — DB query |
| `POST /notifications/:id/read` | ✅ | Real |
| `POST /notifications/read-all` | ✅ | Real |

### §9.9 Export

| Endpoint | Status | Notes |
|---|---|---|
| `GET /documents/:id/export?format=md\|docx` | 🟡 | Stub — placeholder text; no Plate serializer wired |
| `GET /versions/:id/export?format=md\|docx` | 🟡 | Stub — placeholder text; reads nothing from S3 |

### §9.10 Audit

| Endpoint | Status | Notes |
|---|---|---|
| `GET /documents/:id/audit?limit=&before=` | ✅ | Real — paginated, guarded by `can_view_history` |

> **Note:** `audit_log` writes inside mutating endpoints (approve, reject, submit,
> suggestions accept/reject) are partially implemented — versions.py has them,
> but several Person A endpoints mark them "deferred to Stage 3." Not a blocking gap
> for functionality; just incomplete audit trail.

### Non-REST surfaces

| Surface | Status | Notes |
|---|---|---|
| WebSocket `/collab/:doc_id` (Hocuspocus) | ❌ | Not started — no Hocuspocus server configured |
| SSE/WS `/events` (push notifications) | ❌ | Not started — notifications are pull-only currently |
| BullMQ / Redis AI job queue | ❌ | Not started — AI endpoints are stubs |

---

## 2. Backend — Infrastructure / Cross-cutting

| Concern | Status | Notes |
|---|---|---|
| CORS middleware | ✅ | Added in `main.py`; origins from `CORS_ORIGINS` env var |
| `.env` loading | ✅ | `load_dotenv` in `config.py` and `database.py` |
| JWT auth (access token) | ✅ | `deps.py` — `get_current_user` validates Bearer token |
| JWT refresh token store | ❌ | No refresh token persistence (Redis or DB table) |
| Password hashing (bcrypt) | ✅ | `auth_service.py` |
| `authorize()` RBAC guard | ✅ | `auth_service.py` — walks assignments → roles → permissions |
| Alembic migrations | ❌ | No migration files exist; schema created by `create_all` |
| S3 / MinIO integration | ❌ | Not wired; version blobs are text placeholders |
| Redis + BullMQ | ❌ | Not started |
| Hocuspocus server | ❌ | Not started |
| Seed data (roles/permissions) | ✅ | `main.py` startup seeds org, roles, permissions, test user |
| Multi-org / multi-tenant | 🔲 | `org_id` on every table — hook is there; not activated |
| Offline mode (IndexedDB sync) | 🔲 | Deferred by design (v2 per architecture §0 / §11) |
| Email notifications (SMTP) | ❌ | Notifications table exists; no email send wired |

---

## 3. Frontend — API Clients (`frontend/src/lib/api/`)

| File | Status | What it does |
|---|---|---|
| `client.ts` | ✅ | Base fetch wrapper — base URL, Bearer token, `ApiError` |
| `auth.ts` | ✅ | Real — POST `/auth/signup` & `/login`; stores JWT |
| `versions.ts` | ✅ | Real — list, submit, restore; maps backend → `DocVersion` shape |
| `notifications.ts` | ✅ | Real — list, mark read, mark all read |
| `ai.ts` | ✅ | Real — suggest, apply, poll job (backend is stub but client is wired) |
| `export.ts` | ✅ | Real — export document/version, download helper |
| `documents.ts` | ❌ | **Still mock** — 8 functions use localStorage; no fetch calls |
| `comments.ts` | ❌ | **Still mock** — 5 functions use localStorage |
| `collaborators.ts` | ❌ | **Still mock** — 6 functions use localStorage (maps to assignments API) |
| `db.ts` | 🟡 | `uid()` helper only — no API calls |
| `seed.ts` | 🟡 | `CURRENT_USER` placeholder — not from real auth |

### Outstanding frontend mock→real swaps needed

| File | Backend endpoints to wire |
|---|---|
| `documents.ts` | `GET/POST/PATCH/DELETE /documents`, `GET /documents?folder_id=` |
| `comments.ts` | `GET/POST /documents/:id/comments` |
| `collaborators.ts` | `GET/POST/DELETE /assignments`, `GET /users`, `GET /roles` |

> **Blocker for `documents.ts`:** frontend `DocSummary` type has `starred`, `trashed`, and status
> labels `"Working"/"Pending Review"/"Approved"/"Draft"` — none of these columns exist in the
> backend `documents` table (which only has `working`/`pending_approval`). Needs either new
> DB columns or a mapping layer before `documents.ts` can be wired.

---

## 4. Frontend — UI / Editor Features

| Feature | Status | Notes |
|---|---|---|
| Plate editor (Slate.js base) | ✅ | PlateJS packages installed and present |
| Real-time sync (YjsPlugin / Hocuspocus) | ❌ | No Hocuspocus server; YjsPlugin not connected |
| Suggestion marks (`@platejs/suggestion`) | 🟡 | Package installed; governance hook to backend not wired |
| Comment marks (`@platejs/comment`) | 🟡 | Package installed; persistence to backend not wired |
| Diff / review surface (green/red) | ❌ | Not started |
| Recommendations sidebar | ❌ | Not started |
| Approval chain UI (multi-step progress) | ❌ | Not started (policy endpoints not built yet) |
| Export toolbar | ❌ | Backend export endpoints are stubs |
| Remote cursors (cursor overlay) | ❌ | Requires Hocuspocus + YjsPlugin |
| Push notifications (SSE) | ❌ | No SSE/WS `/events` endpoint |
| MSW mock layer | ✅ | `handlers.ts`, `browser.ts`, `server.ts`, `mock-provider.tsx` |
| `NEXT_PUBLIC_API_MOCKING` toggle | ✅ | Off by default; enable in `.env.local` |

---

## 5. Database Schema

| Table group | Tables | Status |
|---|---|---|
| Identity & access | `users`, `roles`, `role_permissions`, `assignments` | ✅ Exist in models |
| Content organization | `folders`, `documents` | ✅ Exist in models |
| Collaboration & review | `suggestions`, `comments`, `edit_attributions`, `notifications` | ✅ Exist in models |
| Versioning & approval | `versions`, `approval_markers`, `approval_policies`*, `approval_policy_steps`*, `approval_step_events`* | ✅ Models exist (18/18 tables) |
| Recommendations | `recommendations`, `recommendation_responses` | ✅ Exist in models |
| Audit | `audit_log` | ✅ Exists in models |

> *`approval_policies`, `approval_policy_steps`, `approval_step_events` tables exist in
> `database_models.py` but the management API (§9.5a) is not built yet.

**Migration status:** No Alembic migration files. Schema is applied via SQLAlchemy
`create_all` at startup. Acceptable pre-launch; needs proper migrations before any
production deployment.

---

## 6. Summary — Counts

| Layer | Done / Wired | Stub | Not Started |
|---|---|---|---|
| Backend REST endpoints (45 total per arch) | **28** | **7** | **10** |
| Frontend API clients (12 files) | **7** | **2** | **3** |
| Infrastructure services | **4** | — | **7** |

### The 10 not-started backend endpoints

1. `POST /auth/refresh`
2. `POST /auth/logout`
3. `GET /versions/:id/approval-status`
4. `GET /approval-policies`
5. `POST /approval-policies`
6. `PATCH /approval-policies/:id`
7. `PATCH /documents/:id/approval-policy`
8. Hocuspocus WebSocket (`/collab/:doc_id`)
9. SSE push (`/events`)
10. AI job queue (BullMQ/Redis worker)

### The 7 stub backend endpoints (real routes, placeholder data)

1. `GET /versions/:id` — fake S3 signed URL
2. `GET /documents/:id/diff` — placeholder text, no Slate diff
3. `GET /documents/:id/export` — placeholder text, no Plate serializer
4. `GET /versions/:id/export` — placeholder text, no S3 read
5. `POST /documents/:id/ai/suggest` — fake job_id
6. `POST /recommendations/:id/ai/apply` — fake job_id
7. `GET /ai/jobs/:job_id` — hardcoded "completed"

---

## 7. What to Build Next (Recommended Order)

1. **Wire `documents.ts`** — highest UI impact; resolve the `starred/trashed` data model mismatch first.
2. **Wire `comments.ts` + `collaborators.ts`** — straightforward mock-to-fetch swaps.
3. **Hocuspocus server** — unblocks real-time editing, cursors, and Yjs-based diff.
4. **JWT refresh / logout** — needed before any production use.
5. **Approval policy CRUD (§9.5a)** — activates the dynamic approval chain feature.
6. **S3 / MinIO** — needed for real version blobs, export, and diff.
7. **BullMQ / Redis** — needed for real AI suggestions.
8. **Alembic migrations** — needed before any shared or production database.
9. **Email notifications** — SMTP integration for approval-request emails.
