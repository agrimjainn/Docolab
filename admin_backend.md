# Docolab Admin — Backend Implementation Record (session 2026-07-08)

Backend + AI-gateway work for the Admin page and backend-governed multi-vendor
AI. **Additive throughout** — no existing route/table behavior changed. Frontend
(admin UI + 3 stat windows) is a later task; wiring is left ready.

## Services / dirs touched
- `backend/` — FastAPI (models, routers, services, migrations)
- `ai-gateway/` — **new** Node service (mirrors `hocuspocus-server`)
- `frontend/` — Next AI routes rewired to the gateway (not build-verified here)

---

## PART A — Admin page (13 requirements)

Admin = a user holding an **org-scoped** role with `can_manage_members`
(`auth_service.is_org_admin`). Org fallback in `resolve_role` already grants
admin authority over every doc/folder in the org — so no rewrite of
`list_documents`/`get_document` was needed. Not a hardcoded account: grant admin
by adding an org-scoped `owner` assignment (bootstrap admin is seeded).

### Schema — migration `0008_admin_features`
- `users.last_seen_at` (presence)
- `documents.ai_model` default `gemini` (per-doc AI model; later normalised in 0009)
- `document_folders` junction (multi-folder placement)

### New files
- `app/api/admin.py` (router, guarded by `require_org_admin`)
- `app/api/presence.py`, `app/services/presence_service.py`, `app/schemas/presence.py`
- `app/schemas/admin.py`
- `require_org_admin` added to `app/api/deps.py`; routers wired in `app/main.py`;
  `ai_model` added (optional) to `DocumentResponse`

### Requirement → endpoint mapping
| # | Requirement | Endpoint(s) |
|---|---|---|
| 1 | Org-id admin access to all docs in the org | `GET /api/admin/documents` (org-wide, not created/shared-filtered) |
| 2 | Assign/change any user's role on a doc incl. creator/owner; add/remove access | `GET/PUT /api/admin/documents/{id}/access`, `DELETE /api/admin/documents/{id}/access/{user_id}` |
| 3 | Search documents | `GET /api/admin/documents?q=` (title ILIKE) |
| 4 | List / delist users from org | `GET /api/admin/users`, `PATCH /api/admin/users/{id}/membership` (delist = `status=disabled`, reversible; can't delist self) |
| 5 | See who is online | `GET /api/admin/users` (`online` derived from `last_seen_at`); `POST /api/presence/heartbeat` (any user) |
| 6 | A doc in multiple folders via Folder(s) dropdown | `GET/PUT /api/admin/documents/{id}/folders` (primary `folder_id` always implied) |
| 7 | Separate admin login/UI | `POST /api/admin/login` (rejects non-admins w/ 403), `GET /api/admin/me` |
| 8 | Admin also a normal user + assign roles | existing create/assign paths unchanged (admin is a user) |
| 9 | Add/remove users from a document | same as #2 (doc-scoped assignments) |
| 10 | Admin-assigned docs show in user's "Shared with me" | admin writes a **document-scoped** assignment → already surfaced by `list_documents` shared filter |
| 11 | Admin assigns AI model per doc (default Gemini) | `PUT /api/admin/documents/{id}/ai-model` (validated vs catalog — see Part B) |
| 12 | See all org people, online/offline, email | `GET /api/admin/users` |
| 13 | Click a user → assign a doc with role (default Collaborator=editor) | `POST /api/admin/users/{id}/assign-document`, `GET /api/admin/users/{id}/documents` |

Role name mapping: Owner→`owner`, Manager→`approver`, Collaborator→`editor`
(default), Viewer→`viewer`.

---

## PART B — Backend-governed, multi-vendor AI (Phases 1–4)

Goal: move model choice + vendor keys OFF the frontend; admin controls model per
doc; support multiple vendors. Chosen architecture: **B-Node-gateway** — FastAPI
= policy/resolver + key-custody authority; a small Node `ai-gateway` = streaming
execution (keeps the Vercel AI SDK UI-message-stream protocol byte-identical, so
zero editor-feature loss); Next = thin relay.

Editor protocol confirmed: **AI SDK v5 UI Message Stream** (`createUIMessageStream`
/ `createUIMessageStreamResponse`, data parts `data-toolName|comment|table`).

### Phase 1 — governed model catalog (`0009_ai_models`)
- `ai_models` table: org-scoped catalog `(vendor, model_key, display_name, enabled, is_default)`; **no keys stored**. `documents.ai_model` normalised `gemini`→`gemini-2.5-flash`.
- `app/services/ai_model_service.py` (list / default / **resolve-with-fallback** / seed); startup seed in `main.py`.
- `GET/POST/PATCH /api/admin/ai/models` (catalog admin, one-default invariant).
- `PUT /api/admin/documents/{id}/ai-model` validates against **enabled** catalog.
- `GET /api/documents/{id}/ai/resolve` — editor asks backend which `{vendor, model_key}` to use (no key), gated on `can_suggest`, org-default fallback.
- Resolver is fail-safe: disabling a model a doc points at falls back to org default; AI never hard-fails.

### Phase 2 — signed AI grant (backend)
- Config: `AI_GATEWAY_URL`, `AI_GATEWAY_SECRET` (defaults to `SECRET_KEY`), `AI_GRANT_TTL_SECONDS=120`.
- `app/services/ai_grant_service.py`: `issue_grant` (JWT `{typ:ai_grant, sub, org, doc, vendor, model, exp}`), `verify_grant`, plus service-token helpers (Phase 4).
- `POST /api/documents/{id}/ai/grant` → `{grant, vendor, model_key, gateway_url, expires_in}`, **no vendor key**. The credential the frontend hands to the gateway.

### Phase 3 — `ai-gateway` Node service + Next rewiring
- `ai-gateway/` (server.js, package.json, .env.example, README, .gitignore). ESM, `dotenv`+`jsonwebtoken`, built-in `http`/`fetch`/streams.
- Verifies grant (HMAC+expiry) → checks vendor+model match → strips caller headers → **injects real vendor key** → forwards → **streams body straight through** (`x-accel-buffering:no`). Vendors: google (live), openai/anthropic (wired, add key). `GET /healthz`. Server-to-server (no CORS).
- Next: `frontend/src/app/api/ai/gateway.ts` builds AI-SDK provider with `baseURL`→gateway + `x-ai-grant` header (dummy apiKey). `command/route.ts` + `copilot/route.ts` prefer gateway, **fall back to env key** if no grant (dev-safe). `use-chat.ts` sends `documentId` (`?doc=`) + `docflow.token`.
- Security: vendor keys live only on the gateway; frontend holds only a seconds-long, unforgeable, single-purpose grant; client cannot pick its own model.

### Phase 4 — usage metering (`0010_ai_usage`)
User-chosen design decisions: **gateway reports actual token usage**;
authenticated by a **backend-signed (shared-secret) service JWT**; **tokens-only,
no pricing yet**; **metric basis = tokens**.
- `ai_usage_events` table: `(org, document→SET NULL, user→SET NULL, vendor, model_key, input/output/total_tokens, request_id UNIQUE, created_at)`.
- `POST /api/internal/ai/usage` (`app/api/internal.py`) — two-layer trust: **service JWT** (authn: it's the gateway) + **forwarded grant** (scope: org/doc/user/vendor/model derived from grant, not gateway's word). Idempotent on `request_id`.
- Gateway: tees the stream (pipe to client + accumulate), per-vendor token extractors (google/openai/anthropic), self-signs a service JWT, POSTs `{grant, request_id, input_tokens, output_tokens}` to backend. New env `BACKEND_URL`.
- Admin aggregations feeding the **Model Usage** section:
  - `GET /api/admin/ai/usage/by-model` → per-model token totals + `pct` of total → **pie (usage %)** + **per-model token/cost list**.
  - `GET /api/admin/ai/usage/by-document?limit=5` → **top-5 docs by tokens desc** → **comparison bar chart**.
  - Both carry `unit:"tokens"` — cost windows show token-based figures until pricing added; schema leaves room for a derived cost column.

---

## Verification done this session
- Backend imports clean; all new routes registered (checked via OpenAPI).
- Migration chain single head `0010`; **`alembic upgrade head` applied to dev DB** (0007→0010 clean).
- Offline SQL validated for 0008/0009/0010.
- Grant + service-token sign/verify round-trip (Python).
- Gateway `node --check` passes; usage extractors unit-tested (google 12/34, openai 100/42, anthropic 40/19 — cumulative/first-input logic correct).
- `backend/test_ai_usage_smoke.py` written (service+grant round-trip, idempotency, auth-failure cases, aggregation ordering). **In-progress** — hit an event-loop/pool issue in the test harness (asyncio.run vs TestClient loop); fix = `engine.dispose()` at loop boundaries (was mid-edit when session ended). The endpoints themselves import and route correctly.

## Loose ends / follow-ups
1. **`documents.folder_id` NOT NULL mismatch** — live DB enforces NOT NULL, but the model annotates `nullable=True` (`# <--- CHANGE THIS`). Never migrated. Pre-existing, not from this session. Reconcile model↔DB (either migrate to nullable or drop the misleading annotation).
2. **Finish `test_ai_usage_smoke.py`** — apply the `engine.dispose()` fix (dispose at end of `setup()` and start of `cleanup()`), re-run to green.
3. **Frontend not build-checked** — `cd frontend && npm run build` to confirm the route/client TS edits (no `next build`/`tsc` run here).
4. **PyJWT ↔ jsonwebtoken interop** relies on standard HS256 (compatible by spec); not run end-to-end (gateway `node_modules` not installed). Prove with `npm install` + one live call.
5. **Copilot client wiring** — copilot plugin doesn't yet send `documentId`/`token`, so copilot uses env-key fallback until wired like `use-chat.ts`.
6. **openai/anthropic** — gateway + resolver support them; seeded **disabled**. Enable in Admin catalog + add gateway keys + `npm i @ai-sdk/openai @ai-sdk/anthropic`.
7. **Admin login enumeration** (optional hardening) — `/api/admin/login` returns 401 (bad creds) vs 403 (valid but not admin); collapse to a single 401 to avoid leaking "account exists but not admin".
8. **Pricing** — add per-token prices + derived cost when ready; aggregations already structured for `unit` swap.

## Deploy / ops (env)
- backend `.env`: `AI_GATEWAY_URL=http://localhost:8787`, `AI_GATEWAY_SECRET=<shared>`; `AUTO_MIGRATE=1` applies 0008–0010 on boot (or `alembic upgrade head`).
- `ai-gateway/.env`: `AI_GATEWAY_SECRET=<same>`, `BACKEND_URL=http://localhost:8000/api`, `GOOGLE_API_KEY=...` (+ optional OPENAI/ANTHROPIC); `npm install && npm run dev` (:8787).
- frontend: `GOOGLE_GENERATIVE_AI_API_KEY` becomes **fallback-only** — remove once the gateway is live.
- Clients should heartbeat `POST /api/presence/heartbeat` ~30s (online window 90s).

## New migrations this session
`0008_admin_features`, `0009_ai_models`, `0010_ai_usage` (linear; head = `0010_ai_usage`).
