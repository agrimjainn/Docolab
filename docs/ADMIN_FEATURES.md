# Docolab — Admin Platform Documentation

*Governance, access control, and AI-model administration surface. Last verified against `main` @ 2026-07-20.*

## 1. Overview

The Admin Platform is a separate, org-scoped control plane layered on top of Docolab's document/collaboration product. It gives one class of user — an **org admin** — org-wide visibility and write-access that a normal RBAC role (Owner/Manager/Collaborator/Viewer) never grants on its own, covering four governance domains:

| Domain | What an admin can do |
|---|---|
| **Users** | List every org member, create members, list/create/delist admin accounts, self-service password change, view/assign a user's documents |
| **Documents** | List every document in the org (search, filter by folder/trash), inspect/edit per-document access (roles), place a document in multiple folders |
| **AI governance** | Maintain a per-org allow-list of callable LLMs, set the org default, assign a model to a user, view token-usage analytics by model and by document |
| **Audit** | Read the org-wide, append-only action log (role changes, logins, document/user updates), independent of any single document |

Admin status is a single, explicit **org-scoped role grant** (`assignments` row with `scope_type="org"`) carrying the `can_manage_members` permission — it is never inferred from folder/document ownership, so the "everyone owns something → everyone is admin" trap is structurally impossible.

## 2. Architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (Next.js)     │        │  Backend (FastAPI)            │
│  /admin/*  (separate    │  REST  │  /api/admin/*  (admin.py)     │
│  login + guard, distinct│◄──────►│  /api/audit    (audit.py)     │
│  "Glacier" theme)       │  JWT   │  /api/ai/*     (ai.py)        │
│                          │        │  app/services/ai_model_service│
│  lib/api/admin.ts       │        │  app/services/ask_ai/*        │
└─────────────────────────┘        │  (LiteLLM router, in-process) │
                                    └──────────────┬─────────────────┘
                                                    │ SQLAlchemy async
                                                    ▼
                                    ┌──────────────────────────────┐
                                    │ PostgreSQL                    │
                                    │ users, roles, role_permissions,│
                                    │ assignments, documents, folders│
                                    │ document_folders, ai_models,   │
                                    │ ai_usage_events, audit_log     │
                                    └──────────────────────────────┘
```

- **Frontend** (`frontend/src/app/admin/`): a self-contained route tree with its own login page (`admin/login`), guard (`admin-guard.tsx`, checks `GET /admin/me` and redirects unauthenticated/non-admin users), and dashboard (`admin/page.tsx`). Visually isolated via a `.glacier`-scoped CSS theme so it never inherits the main app's design system. Components live in `frontend/src/components/admin/`: `admin-top-nav`, `users-panel` (roster + presence), `documents-explorer` (org-wide doc list/search/folder-filter), `document-modal` (per-doc access + folders), `user-modal` (per-user documents + AI model), `analytics-cards` (AI usage charts).
- **Backend** (`backend/app/api/admin.py`): every route depends on `require_org_admin`; nothing here introduces new tables beyond `ai_models`/`ai_usage_events` — it reuses the same `assignments`, `documents`, `folders`, `users` tables the normal user-facing routers use, so an admin action (e.g. granting document access) is immediately visible on the normal user surface (e.g. "Shared with me").
- **AI router** (`backend/app/services/ask_ai/`): in-process LiteLLM wrapper (merged from a formerly standalone service — see project CLAUDE.md). `config.yaml` is the source of truth for which `provider:model_key` pairs are *callable*; `ai_models` is the source of truth for which of those are *enabled per org* and which is default. Admin catalog CRUD (`POST/PATCH /api/admin/ai/models`) can only add keys that already exist in `config.yaml` (`ModelRegistry.list_available_models()`), so an assignable model is by construction reachable.
- **Audit** (`backend/app/api/audit.py`, `app/services/audit_service.py`): every admin write calls `record_audit(...)` inline (same transaction, not a hook) writing an append-only row to `audit_log`. The org-wide feed (`GET /audit`) is gated on `is_org_admin`; per-document feeds are gated on `can_view_history`.

## 3. Software Stack

| Layer | Technology |
|---|---|
| Admin UI | Next.js 16 (App Router) / React 19 / TypeScript, Tailwind v4 + custom "Glacier" glassmorphism theme |
| Admin API | FastAPI + Pydantic v2 (`app/schemas/admin.py`), async endpoints |
| ORM / DB | SQLAlchemy 2.0 async + asyncpg → PostgreSQL; Alembic migrations |
| Auth | JWT (PyJWT) access + refresh tokens, argon2-cffi password hashing — same token infrastructure as the normal app, but `POST /api/admin/login` additionally rejects non-admins |
| AI routing | LiteLLM (`ask_ai/model_registry.py`, `pipeline.py`), provider keys (`GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`) read from `backend/.env` only — never stored in the DB or sent to the client |
| Presence | `app/services/presence_service.py` — derived online/offline from `users.last_seen_at`, no separate presence store |

## 4. Data Model (DB Schema)

All tables are org-partitioned via an `org_id` column (multi-tenant by row, not by schema/DB).

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Login identity | `id, org_id, email (case-insensitive unique), password_hash, display_name, status (active/disabled), ai_model (assigned provider:model_key), last_seen_at` |
| `roles` | Fixed role set per org | `id, org_id, name` — unique `(org_id, name)`; seeded set: `owner / approver / editor / viewer` |
| `role_permissions` | Role → permission strings | composite PK `(role_id, permission)` |
| `assignments` | Scoped role grants — **the single access-control primitive** | `id, org_id, user_id, role_id, scope_type ("org"\|"folder"\|"document"), scope_id`; unique `(user_id, scope_type, scope_id)` |
| `documents` | Core content record | `id, org_id, folder_id, title, status, trashed, ai_model (legacy, unused for resolution), approval_policy_id, created_by` |
| `folders` | Nestable folder tree | `id, org_id, parent_folder_id, name, created_by` |
| `document_folders` | Extra (non-primary) folder placements — admin "file in multiple folders" | composite PK `(document_id, folder_id)` |
| `ai_models` | Per-org **governed allow-list** of callable models | `id, org_id, vendor, model_key, display_name, enabled, is_default`; unique `(org_id, model_key)` |
| `ai_usage_events` | One row per completed AI call (metering) | `id, org_id, document_id, user_id, vendor, model_key, input_tokens, output_tokens, total_tokens, request_id (unique), created_at` |
| `audit_log` | Append-only governance trail | `id, org_id, actor_id, document_id (nullable), action, target_type, target_id, metadata (jsonb), created_at` |

**Access resolution** (`auth_service.authorize` / `resolve_role`): a document-scoped assignment overrides a folder-scoped one, which overrides an org-scoped one. `is_org_admin` checks specifically for an **org-scoped** `can_manage_members` grant — folder/document ownership never satisfies it. `is_super_admin` is identity-based (`settings.SUPER_ADMIN_EMAIL`), not a DB flag: it gates creating/delisting other admin accounts and makes the primary admin permanently non-delistable.

## 5. API Reference

All routes below are prefixed `/api` and require a valid bearer token; every `/admin/*` route additionally requires `require_org_admin` (org-scoped `can_manage_members`), and two require `require_super_admin`.

| Method & Path | Purpose |
|---|---|
| `POST /admin/login` | Admin-only sign-in (same credentials, rejects non-admins) |
| `GET /admin/me` | Confirms admin session; returns `is_admin` / `is_super_admin` flags |
| `POST /admin/change-password` | Self-service password change |
| `GET /admin/users` | List every org user + presence |
| `POST /admin/users` | Create a member (no org-wide role — isolation by default) |
| `GET /admin/admins` · `POST /admin/admins` **(super-admin)** | List / create admin accounts (grants org-scoped `owner`) |
| `PATCH /admin/users/{id}/membership` | List/delist (soft-disable) a user; protects super-admin and enforces admin-delisting hierarchy |
| `GET /admin/users/{id}/documents` | Documents a user created or was shared |
| `POST /admin/users/{id}/assign-document` | Share a document with a user at a chosen role |
| `PUT /admin/users/{id}/ai-model` | Assign a user's AI model (must be enabled in org catalog) |
| `GET /admin/documents` | Org-wide document list — search (`q`), folder filter, trash filter |
| `GET/PUT/DELETE /admin/documents/{id}/access[/{user}]` | Read/set/revoke a user's role on a document, incl. transferring the creator's own role |
| `GET/PUT /admin/documents/{id}/folders` | Read/replace a document's extra folder placements |
| `GET /admin/ai/models` · `POST /admin/ai/models` · `PATCH /admin/ai/models/{id}` | Read/add/update the org's AI-model allow-list (enable, rename, set default) |
| `GET /admin/ai/usage/by-model` · `GET /admin/ai/usage/by-document` | Token-usage analytics, optional trailing-`days` window |
| `GET /audit` | Org-wide audit trail with `action`/`actor_id`/`target_type` filters (org-admin only) |
| `GET /documents/{id}/audit` | Per-document audit trail (any user with `can_view_history`) |
| `GET /roles` | List the fixed role set + permissions (any authenticated user) |
| `GET /ai/models` (user-facing) | The *current user's* resolved model + enabled catalog, read-only |
| `POST /ai/ask` | The editor's Ask-AI call — resolves the caller's assigned model server-side, meters into `ai_usage_events` |

## 6. Governance Workflows

**User lifecycle.** Signup creates a user with *no* org-wide role (per-user isolation is the default — see project history on the isolation fix). An admin either (a) creates a member directly (`POST /admin/users`, still no org-wide grant) or (b) promotes someone to admin (`POST /admin/admins`, super-admin only, grants org-scoped `owner`). Delisting sets `status="disabled"` (soft, reversible — `get_current_user` rejects disabled accounts at login) rather than a hard delete, and is layered: nobody can delist the super admin; only the super admin can delist a fellow admin; any admin can delist a normal user (never themselves).

**Document access control.** Every grant is an `assignments` row. Admin's document-access panel (`GET/PUT/DELETE /admin/documents/{id}/access...`) writes directly to the same table the sharing UI and RBAC resolver use, so a change is instantly visible to the affected user and instantly enforced by `authorize()` on their next request — there is no separate "admin override" code path to keep in sync.

**AI model governance (two-layer allow-list).** `config.yaml` (operator-managed) defines every model the LiteLLM router can physically call. `ai_models` (admin-managed, per org) is a subset of that: which of those are *enabled* for this tenant and which is the *default*. A user's `users.ai_model` must resolve to an enabled catalog row or the resolver silently falls back to the org default — the AI path can never hard-fail on a stale/disabled assignment, and a client can never request an ungoverned model (there is deliberately no `model` field on `POST /ai/ask`). Disabling a model an admin previously assigned to users is safe for the same reason.

**Usage metering & analytics.** Every successful `POST /ai/ask` call writes one `ai_usage_events` row using the *vendor's actual reported token counts* (never client-supplied), attributed via the authenticated session — a client cannot bill usage to another user or document. `GET /admin/ai/usage/by-model` and `.../by-document` aggregate this for the dashboard's usage-% pie and top-documents bar chart (tokens only; per-token cost/pricing is an intentional later addition, no schema change needed).

**Audit trail.** Every admin mutation (`admin_login`, membership change, role grant/revoke, AI-model catalog change, folder placement) calls `record_audit()` in the same DB transaction as the change itself, tagged `meta.admin=true` to distinguish admin-initiated actions from a normal user's own. The log is append-only (no update/delete route exists) and is exposed org-wide only to admins; a normal user can only see the audit trail of documents they can already view.

## 7. Security Model

- **Admin authority is one explicit signal**: an org-scoped `assignments` row granting `can_manage_members`. It is not derivable from any other permission, closing the "creator-owns implies admin" escalation path.
- **Super-admin is identity-based** (config-pinned email), separating "can administer the org" from "can create/remove other admins" — a compromised created-admin account cannot mint new admins or remove the primary one.
- **AI keys never leave the backend process** — `backend/.env` only; the client receives a resolved `model_key`/`display_name`, never a credential.
- **Tenant isolation**: every admin query is scoped by `admin.org_id`; cross-org document/user IDs 404 rather than leak existence.
- **Reversibility by default**: user delisting and model disabling are soft/reversible; nothing in the admin surface hard-deletes a user or a model row.

## 8. Known Gaps / Roadmap

- "Add User" AI-model + role UI is functional; token **pricing** (cost, not just volume) is deliberately deferred — `ai_usage_events` is schema-ready for it.
- Admin panel has no bulk operations (bulk delist, bulk re-assign) — all actions are single-entity.
- No UI-level audit-log export; consumption is paginated JSON only (`GET /audit`).
