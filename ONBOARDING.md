# Docolab — Complete Project Guide

> For new members, returning developers, and anyone planning the next phase.

---

## Table of Contents

1. [What is this app? (Simple explanation)](#1-what-is-this-app)
2. [How the app works (technical)](#2-how-the-app-works-technical)
3. [Function map — what lives where](#3-function-map--what-lives-where)
4. [How to build this from scratch — phases](#4-how-to-build-this-from-scratch--phases)
5. [What we have done (with phases)](#5-what-we-have-done)
6. [What is next (upcoming phases)](#6-what-is-next)

---

## 1. What is this app?

### Simple explanation

Docolab is a **Google-Docs-style collaborative document editor** built for teams that need a structured review and approval process.

Imagine you work in a company where before any document goes live it must be reviewed and approved. Here is the story of how it works:

1. **You create a document** and start writing. Others can join and edit at the same time — live, like Google Docs.
2. **Some people can only suggest changes**, not directly edit. Their changes show up in green/red (like Word's Track Changes). An authorized person then accepts or rejects them.
3. **When the document is ready**, someone submits it for approval. Depending on the document, it might need approval from one person (the owner) or a whole chain of people (e.g. Team Lead → Department Head → Legal).
4. **The approver reviews a diff** — a clean view of exactly what changed since the last approval. They can approve, reject, or add recommendations.
5. **On approval**, the document advances to a new version. Everyone is notified. The history is permanently saved.
6. An **AI assistant** can suggest improvements inline — treated exactly like a human suggestion, so a human still approves it.

The core idea: **the editor is just the writing surface. The real product is the governance** — who can change what, who approves it, and a complete audit trail of every decision.

---

## 2. How the app works (technical)

### The five layers

```
┌─────────────────────────────────────────────────────────┐
│  L1 — Browser / Next.js 16 + React 19                  │
│       Plate (Slate.js) editor  ·  UI pages              │
├─────────────────────────────────────────────────────────┤
│  L2 — Sync (NOT YET BUILT)                             │
│       Hocuspocus WebSocket server  ·  Yjs CRDT          │
├─────────────────────────────────────────────────────────┤
│  L3 — Persistence                                       │
│       PostgreSQL (metadata)  ·  S3/MinIO (blobs)        │
├─────────────────────────────────────────────────────────┤
│  L4 — Backend / FastAPI (Python)                        │
│       REST API  ·  RBAC  ·  Approval workflow           │
├─────────────────────────────────────────────────────────┤
│  L5 — AI Worker (NOT YET BUILT)                        │
│       Redis + BullMQ  ·  LLM API                        │
└─────────────────────────────────────────────────────────┘
```

### Request flow (what happens when you type in the editor)

```
User types
    │
    ▼
Plate editor (Slate.js)          ← currently: no live sync
    │  (future: Yjs update)
    ▼
Hocuspocus WebSocket server      ← NOT BUILT YET
    │  broadcasts to all clients
    ▼
Other browsers update instantly
    │
    ▼
FastAPI REST endpoint            ← runs on every governance action
    │  (submit, approve, reject, resolve suggestion…)
    ▼
PostgreSQL (stores metadata,     S3 / MinIO (stores version
 suggestions, versions, audit)    blobs: approved Slate JSON)
```

### Auth flow

```
Sign up / Login  →  FastAPI hashes password (bcrypt)
                 →  Returns JWT (access token)
                 →  Browser stores JWT in localStorage
                 →  Every API call sends: Authorization: Bearer <token>
                 →  FastAPI validates JWT on every request
                 →  Resolves user → role → permissions from DB
```

### Approval flow

```
Editor submits doc
    │
    ▼
POST /documents/:id/submit-for-approval
    → freeze Slate snapshot → save to S3 (warm tier)
    → set documents.status = "pending_approval"
    → notify approver(s)
    │
    ▼
Approver sees diff (what changed since last approval)
    │
    ├── Approve ──→ POST /versions/:id/approve
    │                 → materialize final Slate blob → cold S3
    │                 → write approval_markers row (baseline moves)
    │                 → notify all, status = "working"
    │
    └── Reject ───→ POST /versions/:id/reject
                      → discard warm blob
                      → recommendations saved
                      → status = "working"
```

### RBAC (permissions)

Every user has a **role on a specific folder or document** (never globally). The chain is:

```
User  →  Assignment (scoped to folder/document)
      →  Role (owner / approver / editor / suggester / viewer)
      →  RolePermission rows (can_edit_direct, can_suggest, can_give_final_approval…)
```

The server calls `authorize(user, permission, scope)` on **every mutating endpoint** before doing anything.

---

## 3. Function map — what lives where

### Backend (`backend/app/`)

```
app/
├── main.py                  # FastAPI app, CORS middleware, router mounts, startup seed
├── core/
│   ├── config.py            # Settings (reads .env), CORS origins list
│   ├── database.py          # Async SQLAlchemy engine, session factory, get_db()
│   └── security.py          # bcrypt hashing, JWT create/verify
├── models/
│   └── database_models.py   # All 18 SQLAlchemy table models
├── schemas/                 # Pydantic request/response shapes (one file per domain)
│   ├── auth.py              # SignupRequest, LoginRequest, TokenResponse
│   ├── document.py          # DocumentCreate, DocumentResponse, DocumentUpdate
│   ├── folder.py            # FolderCreate, FolderResponse
│   ├── suggestion.py        # SuggestionCreate, SuggestionOut
│   ├── comment.py           # CommentCreate, CommentOut
│   ├── version.py           # VersionResponse, SubmitForApprovalRequest, ApprovalRequest
│   ├── notification.py      # NotificationResponse
│   ├── recommendation.py    # RecommendationCreate, RecommendationOut
│   ├── ai.py                # AISuggestRequest, JobStatusResponse
│   ├── export.py            # ExportResponse
│   ├── assignment.py        # AssignmentCreate, AssignmentResponse
│   ├── role.py              # RoleResponse, RoleListResponse
│   └── audit.py             # AuditLogOut
├── api/                     # Route handlers (one file per domain)
│   ├── deps.py              # get_current_user() dependency
│   ├── auth.py              # signup, login, me
│   ├── users.py             # list users, update user
│   ├── roles.py             # list roles
│   ├── assignments.py       # create, list, delete assignment
│   ├── folders.py           # CRUD folders
│   ├── documents.py         # CRUD documents
│   ├── suggestions.py       # list, create, accept, reject suggestions
│   ├── comments.py          # list, create comments
│   ├── recommendations.py   # list, create, update recommendations + responses
│   ├── versions.py          # list versions, submit, diff, approve, reject, restore
│   ├── notifications.py     # list, mark read
│   ├── ai.py                # suggest, apply, job status
│   ├── export.py            # export document/version to md/docx
│   ├── audit.py             # paginated audit log
│   └── ownership.py         # transfer document ownership
└── services/
    └── auth_service.py      # authorize() guard, password verify, JWT decode
```

### Database (18 tables — `database_models.py`)

```
Group A — Identity & Access
  users               who can log in (never hard-deleted)
  roles               owner / approver / editor / suggester / viewer
  role_permissions    rows linking role → permission string
  assignments         user has role on a specific folder or document

Group B — Content Organisation
  folders             nestable folders (parent_folder_id = NULL → root)
  documents           title, status, yjs_doc_key, starred, trashed,
                      approval_policy_id (NULL = single owner gate)

Group C — Collaboration & Review
  suggestions         pending tracked changes (insert/delete/replace/format)
  comments            threaded discussion, linked to doc or suggestion
  edit_attributions   per-region event history (who typed/deleted what)
  notifications       approval events (request / approved / rejected)

Group D — Versioning & Approval
  versions            submission (warm) or approved (cold) snapshot pointer
  approval_markers    baseline pointer — latest row = current approved state
  approval_policies   named multi-step approval chain definition
  approval_policy_steps  ordered rungs of a chain (role required per step)
  approval_step_events   per-submission ledger (who approved which step)
  recommendations     owner notes attached to a version (on approve OR reject)
  recommendation_responses  team replies to recommendations (append-only)

Group E — Audit
  audit_log           append-only record of every governance action
```

### Frontend (`frontend/src/`)

```
app/
├── page.tsx                 # Sign-up / login page (/ route)
├── browser/page.tsx         # Document browser (list, filter, star, trash)
├── editor/page.tsx          # Document editor shell (loads PlateEditor)
└── api/ai/                  # Next.js API routes for Plate AI (command, copilot)

components/
├── editor/
│   ├── plate-editor.tsx     # Main editor component — assembles everything
│   ├── editor-kit.tsx       # Full plugin stack (all features enabled)
│   ├── editor-base-kit.tsx  # Minimal plugin stack (read-only / static)
│   ├── editor-top-bar.tsx   # Toolbar: title, share, version, export buttons
│   ├── doc-menubar.tsx      # File/Edit/View menu bar
│   ├── comments-panel.tsx   # Right-side comments / discussions panel
│   └── plugins/             # One file per Plate plugin kit
│       ├── suggestion-kit.tsx      track changes (SuggestionPlugin)
│       ├── comment-kit.tsx         comment marks
│       ├── discussion-kit.tsx      discussion threads
│       ├── ai-kit.tsx              AI ghost text / command palette
│       ├── yjs-kit.tsx             (placeholder — not wired yet)
│       └── ...                     (30+ other plugin kits)
├── side-nav.tsx             # Left sidebar (filters: All / Starred / Trash…)
└── top-nav.tsx              # Top navigation bar

lib/
├── types.ts                 # All TypeScript types (User, DocSummary, DocVersion…)
├── data.ts                  # Static UI data (STATUS_CLASS, filter labels)
├── utils.ts                 # cn() helper (Tailwind class merge)
├── store/
│   └── document-store.tsx   # React context: loads doc, saves content, readOnly state
├── api/
│   ├── client.ts            # Base fetch wrapper (Bearer token, ApiError, apiFetch)
│   ├── auth.ts              # signUp, signIn → real backend ✅
│   ├── versions.ts          # listVersions, submitForApproval, restore → real backend ✅
│   ├── notifications.ts     # listNotifications, markRead → real backend ✅
│   ├── ai.ts                # suggest, applyToRecommendation, getJob → real backend ✅
│   ├── export.ts            # exportDocument, exportVersion → real backend ✅
│   ├── documents.ts         # listDocuments, createDocument… → STILL MOCK ❌
│   ├── comments.ts          # getDiscussions, saveDiscussions → STILL MOCK ❌
│   └── collaborators.ts     # getShareState, inviteCollaborator… → STILL MOCK ❌
├── hooks/
│   └── use-presence.ts      # Live presence hook (mock — needs Hocuspocus)
└── suggestion.ts            # Plate suggestion plugin helpers

mocks/
├── handlers.ts              # MSW locked API contract (mirrors backend schemas)
├── browser.ts               # MSW service worker setup (dev browser)
├── server.ts                # MSW node server setup (tests)
└── mock-provider.tsx        # Starts MSW when NEXT_PUBLIC_API_MOCKING=enabled
```

---

## 4. How to build this from scratch — phases

If you were starting from zero, here is the exact order to follow. Each phase produces something runnable.

---

### Phase 0 — Foundations (1–2 days)

Set up the project skeleton so everyone can run something.

- Create the repo, folder structure (`backend/`, `frontend/`)
- Backend: FastAPI app, PostgreSQL connection via SQLAlchemy async, `.env` loading, Alembic
- Frontend: Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- Write the initial Alembic migration for the full 18-table schema
- Seed script: one default org, 5 roles, one admin user, one root folder
- Confirm: backend starts at `localhost:8000`, frontend at `localhost:3000`

**Deliverable:** Empty app that connects to the database.

---

### Phase 1 — Identity & RBAC (2–3 days)

Before anything else works, you need to know who the user is.

- `POST /auth/signup` — hash password with bcrypt, return JWT
- `POST /auth/login` — verify password, return JWT
- `GET /auth/me` — decode JWT, return current user
- `authorize(user, permission, scope)` service function — the single chokepoint used by every later endpoint
- Role + assignment CRUD (`/roles`, `/assignments`)
- Frontend: sign-up page, sign-in page, JWT stored in localStorage, `apiFetch` wrapper that sends Bearer token

**Deliverable:** Users can create accounts and log in. Every subsequent request is authenticated.

---

### Phase 2 — Document Organisation (2 days)

Users need a place to store documents.

- Folder CRUD (`/folders`) with nested parent support
- Document CRUD (`/documents`) — create, list, get, update, soft-delete
- Auto-assign owner role to the document/folder creator
- Frontend: document browser page — list, create, filter (all / starred / trash), search

**Deliverable:** Users can create folders and documents and see them in a list.

---

### Phase 3 — The Editor (3–5 days)

The writing surface. This is the biggest visual phase.

- Install Plate editor with the full plugin stack (basic blocks, marks, lists, tables, links)
- Wire `document-store.tsx` — load document content, auto-save on change, ⌘S manual save
- Editor page: top bar (title, share button, version history), menubar, comments panel
- At this point the editor is **local only** (no real-time sync — that comes later)

**Deliverable:** A working rich-text editor. One user can write and save a document.

---

### Phase 4 — Suggestions & Comments (inner review loop) (3 days)

Track changes and discussion threads.

- Backend: suggestions CRUD (`/documents/:id/suggestions`, accept, reject)
- Backend: comments CRUD (`/documents/:id/comments`) with threading
- Frontend: Plate `SuggestionPlugin` wired — suggest-mode toggle, green/red marks
- Frontend: `@platejs/comment` + discussion plugin wired — comment marks, comments panel

**Deliverable:** Suggesters can propose changes; resolvers can accept/reject them inline.

---

### Phase 5 — Versioning & Approval (outer governance loop) (4–5 days)

The core governance product.

- Backend: `POST /documents/:id/submit-for-approval` — freeze snapshot
- Backend: `GET /documents/:id/diff` — attributed diff since last approval
- Backend: `POST /versions/:id/approve` and `/reject` — advance or discard
- Backend: `POST /versions/:id/restore` — restore a deleted section
- Backend: recommendations + response threads
- Frontend: version history panel, diff viewer (green/red), recommendations sidebar
- Frontend: approval status UI

**Deliverable:** The full approval loop works. Documents can be submitted, reviewed, approved/rejected, and versioned.

---

### Phase 6 — Notifications (1–2 days)

Keep everyone informed of governance events.

- Backend: write notification rows on submit / approve / reject
- Backend: `GET /notifications`, mark read, mark all read
- Frontend: notification bell with unread count, notification list

**Deliverable:** Users receive in-app notifications on approval events.

---

### Phase 7 — Real-time Collaboration (3–5 days)

Multiple users editing at the same time.

- Install `yjs`, `@platejs/yjs`, `@hocuspocus/provider`, `@slate-yjs/core`
- Set up a Hocuspocus Node.js server (`onAuthenticate` validates JWT, sets read/write mode)
- Wire `YjsPlugin` into the Plate editor with the Hocuspocus provider URL
- Remote cursors (cursor overlay), per-user undo stacks
- `getPresence()` — live "who is in this document"

**Deliverable:** Multiple users can edit the same document simultaneously and see each other's cursors.

---

### Phase 8 — Export (1–2 days)

Download documents.

- `GET /documents/:id/export?format=md` — serialize Slate JSON → Markdown via `@platejs/markdown`
- `GET /documents/:id/export?format=docx` — serialize Slate JSON → Word via `@platejs/docx`
- `GET /versions/:id/export` — same but read from S3 blob
- Frontend: export button in the toolbar

**Deliverable:** Documents can be downloaded as Markdown or Word files.

---

### Phase 9 — AI Suggestions (3–4 days)

AI-powered improvement suggestions.

- Set up Redis + BullMQ job queue
- AI worker process: pull job → serialize doc to Markdown → call LLM API → parse response → POST suggestions
- `POST /documents/:id/ai/suggest` — enqueue job, return job ID
- `GET /ai/jobs/:job_id` — poll status
- Frontend: AI suggestion button, poll until complete, suggestions appear inline

**Deliverable:** Users can ask the AI for suggestions; they appear as reviewable suggestion marks.

---

### Phase 10 — Dynamic Approval Chain (2–3 days)

Multi-step approval beyond the simple single-owner gate.

- Backend: approval policy CRUD (`/approval-policies`, `PATCH /documents/:id/approval-policy`)
- Backend: `GET /versions/:id/approval-status` — chain progress
- Update `POST /versions/:id/approve` to walk the chain step by step
- Frontend: policy builder UI, chain progress indicator

**Deliverable:** Documents can require approval from multiple people in a defined order.

---

### Phase 11 — Production Hardening (ongoing)

- JWT refresh tokens + secure logout
- Alembic migration pipeline (instead of `create_all`)
- S3 / MinIO real integration (replace placeholder blobs)
- Email notifications (SMTP for approval requests)
- Rate limiting, error monitoring (Sentry), structured logging
- Docker Compose for the full stack (backend + Hocuspocus + Redis + frontend)

---

## 5. What we have done

### ✅ Phase 0 — Foundations (DONE)

- FastAPI project structure created
- SQLAlchemy async engine, `get_db()` session dependency
- All 18 tables modelled in `database_models.py`
- Startup seed: default org, 5 roles + permissions, admin user, root folder
- Next.js 16 + Tailwind + shadcn/ui frontend bootstrapped
- CORS middleware added (`CORSMiddleware` in `main.py`)
- `.env` loading in both `config.py` and `database.py`
- Alembic initial migration (`0001_initial_initial_schema_18_tables.py`)
- **DB column additions:** `documents.starred`, `documents.trashed`, `comments.is_resolved` added via migration `0002`

---

### ✅ Phase 1 — Identity & RBAC (DONE)

- `POST /api/auth/signup` — bcrypt password hash, JWT returned
- `POST /api/auth/login` — password verify, JWT returned
- `GET /api/auth/me` — current user from JWT
- `authorize(user, permission, scope)` in `auth_service.py`
- Roles: `GET /api/roles`
- Assignments: `GET`, `POST`, `DELETE /api/assignments`
- Users: `GET /api/users`, `PATCH /api/users/:id`
- Frontend `auth.ts` wired to real backend (replaces localStorage mock)
- Frontend `client.ts` — base fetch wrapper with Bearer token

---

### ✅ Phase 2 — Document Organisation (DONE)

- Folders: full CRUD at `/api/folders`
- Documents: full CRUD at `/api/documents`
- Auto-owner-grant on create (creator gets owner role)
- Schema updated: `starred`, `trashed` on `DocumentResponse` and `DocumentUpdate`
- Frontend document browser page exists (still uses localStorage mock for list — Phase 2b)

---

### ✅ Phase 3 — Editor (DONE — local only, no real-time sync)

- Plate editor assembled with full plugin stack (`editor-kit.tsx`)
- All major plugins installed: basic blocks, marks, lists, tables, links, code blocks, media, math, emoji, excalidraw, footnotes, comments, suggestions, AI, export toolbar
- `document-store.tsx` — loads document, handles content changes, ⌘S save
- Editor top bar, doc menubar, comments panel all present
- Yjs / Hocuspocus **not yet connected** (local editor only)

---

### ✅ Phase 4 — Suggestions & Comments (DONE — backend wired)

- `GET /api/documents/:id/suggestions` — list (filterable by status)
- `POST /api/documents/:id/suggestions` — create (human or AI, same endpoint)
- `POST /api/suggestions/:id/accept` — accept, writes `edit_attributions`
- `POST /api/suggestions/:id/reject` — reject with reason
- `GET /api/documents/:id/comments` — list (with `?since=` filter)
- `POST /api/documents/:id/comments` — create (threaded via `parent_comment_id`)
- `@platejs/suggestion` and `@platejs/comment` packages installed; frontend wiring to backend still uses mock
- `is_resolved` column added to `comments` table

---

### ✅ Phase 5 — Versioning & Approval (DONE — DB wired, S3 is placeholder)

- `GET /api/documents/:id/versions` — list version history
- `GET /api/versions/:id` — version metadata (S3 URL is a placeholder)
- `POST /api/documents/:id/submit-for-approval` — creates submission row, notifies
- `GET /api/documents/:id/diff` — placeholder (real Slate diff not implemented)
- `POST /api/versions/:id/approve` — single-gate + chain-aware logic
- `POST /api/versions/:id/reject` — discards submission, records recommendations
- `POST /api/versions/:id/restore` — section restore (full-snapshot stopgap)
- Recommendations: full CRUD + response threads
- Frontend `versions.ts` wired to real backend

---

### ✅ Phase 6 — Notifications (DONE)

- `GET /api/notifications?unread=true`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- Frontend `notifications.ts` wired to real backend
- Push (SSE/WebSocket) not yet built — pull-only currently

---

### ✅ AI & Export clients (DONE — backend is stub)

- `POST /api/documents/:id/ai/suggest` — wired (returns fake job ID)
- `POST /api/recommendations/:id/ai/apply` — wired (stub)
- `GET /api/ai/jobs/:job_id` — wired (returns "completed")
- `GET /api/documents/:id/export` — wired (returns placeholder text)
- `GET /api/versions/:id/export` — wired (returns placeholder text)
- Frontend `ai.ts` and `export.ts` clients — real fetch calls

---

### ✅ MSW Mock Layer (DONE)

- `frontend/src/mocks/handlers.ts` — locked API contract for all governance endpoints
- `frontend/src/mocks/browser.ts` + `server.ts` — browser worker + node server
- `frontend/src/mocks/mock-provider.tsx` — mounts when `NEXT_PUBLIC_API_MOCKING=enabled`
- Enables frontend development with zero backend dependency

---

### ✅ Route & CORS Fixes (DONE)

- Double-prefix routing bug fixed (versions/ai/export now mount at bare `/api`)
- CORS middleware added — browser frontend can now call the API cross-origin
- `Query(regex=)` → `Query(pattern=)` FastAPI deprecation fixed

---

## 6. What is next

### Phase 2b — Wire `documents.ts` to real backend (immediate)

**Why:** the document browser still reads from localStorage. Sign-up creates a real user but sees no documents.

**What to do:**
1. Run Alembic migration `0002` to add `starred` and `trashed` columns
2. Replace 8 functions in `frontend/src/lib/api/documents.ts` with `apiFetch` calls
3. Map `documents.status` (`working` / `pending_approval`) to frontend display labels
4. Compute `updatedLabel` from `updated_at` on the frontend
5. Compute `collaboratorCount` from a `GET /assignments?scope_type=document&scope_id=` count

---

### Phase 2c — Wire `comments.ts` and `collaborators.ts`

**comments.ts:**
- Map flat backend comments → Plate `TDiscussion` thread groups (group by `parent_comment_id`)
- Store Slate rich-text in `body` as JSON string, or add a `content_rich jsonb` column
- Use `is_resolved` column (now exists) for thread resolution

**collaborators.ts:**
- Wire `getShareState` → `GET /assignments?scope_type=document&scope_id=` + `GET /users`
- Wire `inviteCollaborator` → `POST /assignments`
- Wire `removeCollaborator` → `DELETE /assignments/:id`
- Map role names: frontend `"commenter"` ↔ backend `"suggester"`
- `generalAccess` and `linkRole` need new columns on `documents` table
- `getPresence` — blocked until Hocuspocus is running

---

### Phase 7 — Real-time Collaboration (biggest remaining feature)

**Install:**
```bash
npm install yjs @platejs/yjs @hocuspocus/provider @slate-yjs/core
```

**Backend (new Node.js server):**
```
hocuspocus-server/
├── server.ts       # @hocuspocus/server with onAuthenticate (validates JWT)
├── database.ts     # onLoadDocument / onStoreDocument (read/write Yjs binary)
```

**Frontend:**
- Wire `YjsPlugin` in `editor-kit.tsx` with Hocuspocus provider URL
- Cursor overlay (remote user cursors) via `@platejs/yjs`
- `getPresence()` reads Yjs awareness state

**Why this unblocks:**
- `documents.ts` content field (currently served from localStorage)
- `collaborators.ts` live presence
- Real diff computation (Slate JSON diff between Yjs snapshots)

---

### Phase 8 — Real Export

Replace placeholder text with real serializers:
- `@platejs/markdown` `serializeMd` for Markdown export
- `@platejs/docx` for Word export
- Read Slate JSON from Hocuspocus (current doc) or S3 (version blob)

---

### Phase 9 — Real AI Worker

Replace stub endpoints with real processing:
1. Set up Redis
2. BullMQ worker process: serialize doc → call LLM → POST suggestions
3. Update `POST /ai/suggest` to enqueue a real job
4. Update `GET /ai/jobs/:id` to read real job state from Redis

---

### Phase 10 — Dynamic Approval Chain CRUD

4 endpoints not yet built (the chain feature is designed but the management API is missing):

| Endpoint | Purpose |
|---|---|
| `GET /approval-policies` | List all chains in the org |
| `POST /approval-policies` | Create a new chain with ordered steps |
| `PATCH /approval-policies/:id` | Rename / edit steps |
| `PATCH /documents/:id/approval-policy` | Attach or detach a chain from a document |
| `GET /versions/:id/approval-status` | Show chain progress for a submission |

---

### Phase 11 — Auth Completion

- `POST /auth/refresh` — exchange refresh token for new access JWT (needs a Redis or DB token store)
- `POST /auth/logout` — invalidate refresh token
- Token rotation strategy

---

### Phase 12 — Production Hardening

- Move from `create_all` to Alembic migration pipeline
- Real S3 / MinIO integration (replace all placeholder blob strings)
- Email notifications via SMTP (send email when document is submitted for approval)
- SSE or WebSocket `/events` endpoint (push notifications, replace polling)
- Docker Compose: PostgreSQL + Redis + backend + Hocuspocus server + frontend
- Rate limiting on auth endpoints
- Structured logging + error monitoring (Sentry)
- `.env.production` template

---

## Quick reference — running the app locally

```bash
# Backend
cd backend
python -m venv venv && venv\Scripts\activate    # Windows
pip install -r requirements.txt
cp .env.example .env                            # set DATABASE_URL
alembic upgrade head                            # run migrations
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
cp .env.local.example .env.local               # set NEXT_PUBLIC_API_URL
npm run dev                                     # starts at localhost:3000

# Enable MSW mocks (no backend needed)
# In frontend/.env.local:
NEXT_PUBLIC_API_MOCKING=enabled
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

**Default test credentials (seeded on first startup):**
- Email: `admin@acme.com`
- Password: `adminsecret`
