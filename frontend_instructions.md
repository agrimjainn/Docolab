# Frontend Instructions — Role-Based Editor Views (Backend Agent → Frontend Agent)

**Author:** Backend Agent
**Date:** 2026-06-22
**Audience:** Frontend Agent implementing role-aware editor views.
**Read first:** `backend/API_COMMUNICATION_GUIDE.md`, `INTEGRATION_CHANGES.md`.

This document tells you EXACTLY which backend APIs to call to build the four
role views (Owner / Manager / Collaborator / Viewer), how to derive a user's
role on a document, how the approval + feedback flow wires up, and how to wire
the two still-mocked endpoints you were explicitly asked to wire:

- `PATCH  /documents/:id`  (rename / move / trash-restore)
- `DELETE /documents/:id`  (permanent delete)

> **Golden rule (from the architecture, Principle 4 / §6):** the backend is the
> ONLY authority. The role-views you build are **UX only** — never self-authorize.
> Every mutating call is re-checked server-side and returns **403** if the user
> lacks the permission. Build the views to *hide* what a role cannot do, but
> assume the server is the real gate and handle 403 gracefully.

---

## 0. The single most important thing: role names DO NOT match

Your spec uses **Owner / Manager / Collaborator / Viewer**. The backend has a
**fixed, seeded** role set with DIFFERENT names: **owner / approver / editor /
viewer** (see `backend/app/main.py` → `ROLE_PERMISSIONS`). You must map between
them. **Do not invent new backend roles** — the spec says "do not affect backend
functionality." Use this mapping:

| Your UI role  | Backend role name | Permissions the backend grants it                                                                                                  |
|---------------|-------------------|------------------------------------------------------------------------------------------------------------------------------------|
| **Manager**   | `owner`           | `can_edit_direct`, `can_suggest`, `can_resolve_suggestion`, `can_submit_for_approval`, `can_give_final_approval`, `can_approve_level`, `can_manage_approval_policy`, `can_view_history`, **`can_manage_members`** |
| **Collaborator** | `editor`       | `can_edit_direct`, `can_suggest`, `can_submit_for_approval`, `can_view_history`                                                     |
| **Viewer**    | `viewer`          | `can_view_history` (read-only; NO edit, NO comment)                                                                                 |
| **Owner** (badge) | `owner` + creator | Same perms as Manager. "Owner" is the user where `document.created_by === me` AND they hold the `owner` role. See §6.            |

**Why Manager = `owner` and not `approver`:** your Manager must do two things —
**assign roles to others** AND **approve/decline versions**. Only the backend
`owner` role carries `can_manage_members` (the assign-roles permission). The
backend `approver` role can approve but CANNOT manage members, so it does not
satisfy your Manager spec. Treat backend `approver` as an unused middle tier for
now (or optionally surface it as a "Reviewer" later — not required).

### Display mapping helper (build this once)

```ts
// lib/roles.ts
export type UiRole = "Owner" | "Manager" | "Collaborator" | "Viewer";

/** backend role name -> UI label. `isCreator` distinguishes Owner from Manager. */
export function toUiRole(backendRole: string | null, isCreator: boolean): UiRole | null {
  switch (backendRole) {
    case "owner":    return isCreator ? "Owner" : "Manager";
    case "approver": return "Manager"; // optional middle tier, treat as Manager-lite
    case "editor":   return "Collaborator";
    case "viewer":   return "Viewer";
    default:         return null; // no access
  }
}

/** UI label -> backend role name to send when assigning. Owner & Manager both grant `owner`. */
export function toBackendRole(ui: UiRole): "owner" | "editor" | "viewer" {
  if (ui === "Owner" || ui === "Manager") return "owner";
  if (ui === "Collaborator") return "editor";
  return "viewer";
}
```

---

## 1. Auth & transport (already wired — just use it)

- Base URL: `process.env.NEXT_PUBLIC_API_URL` → falls back to `http://localhost:8000/api`.
- Use the existing wrapper `apiFetch<T>(path, init)` in
  [client.ts](frontend/src/lib/api/client.ts). It already attaches
  `Authorization: Bearer <token>` from `localStorage["docflow.token"]`, sets
  JSON headers, parses 204, and throws `ApiError(status, detail)` on non-2xx.
- Auth (`POST /api/auth/login`, `/signup`) is already wired in
  [auth.ts](frontend/src/lib/api/auth.ts) and stores the JWT. There is **no
  OAuth** on the backend.
- **Local dev with no backend:** MSW mock layer exists (`NEXT_PUBLIC_API_MOCKING=enabled`
  in `.env.local`). See `INTEGRATION_CHANGES.md`. If you add new endpoints to
  the views, mirror their shapes in `frontend/src/mocks/handlers.ts`.

All paths below are **relative to `/api`** (so `apiFetch("/documents/123")` hits
`http://localhost:8000/api/documents/123`).

---

## 2. Deriving the current user's role on a document (THE core call)

There is **no single "what's my role" endpoint**, but there is exactly the right
primitive: **`GET /documents/:id/authorize-check?permission=<perm>`**. It runs
the same `authorize()` the mutating endpoints run, AND it returns the
**resolved role name** and the scope it came from.

```
GET /api/documents/{id}/authorize-check?permission=can_view_history
→ 200 { "allowed": true, "resolved_role": "owner", "via_scope": "document:..." }
```

Response shape (`AuthorizeCheckResponse`):
```ts
interface AuthorizeCheckResponse {
  allowed: boolean;
  resolved_role: "owner" | "approver" | "editor" | "viewer" | null;
  via_scope: string | null; // e.g. "document:<uuid>" or "folder:<uuid>" (inherited)
}
```

### How to use it to pick a view (ONE call is enough)

Call it once with **`can_view_history`** — every role that has *any* access holds
this permission, so `resolved_role` will be populated for owner/editor/viewer
alike, and `allowed=false` + `resolved_role=null` means **no access**.

```ts
// lib/api/roles.ts
import { apiFetch } from "@/lib/api/client";

export interface MyAccess {
  backendRole: "owner" | "approver" | "editor" | "viewer" | null;
  viaScope: string | null;        // null = no access
}

export async function getMyAccess(docId: string): Promise<MyAccess> {
  const res = await apiFetch<AuthorizeCheckResponse>(
    `/documents/${docId}/authorize-check?permission=can_view_history`,
  );
  return { backendRole: res.resolved_role, viaScope: res.allowed ? res.via_scope : null };
}
```

Then combine with creator check (§6) to get the UI role:
`toUiRole(access.backendRole, doc.created_by === currentUserId)`.

> **Important nuance — inherited roles.** `resolved_role` may come from a parent
> **folder** (`via_scope = "folder:..."`), not a direct document grant. That is
> correct and intended — a folder owner is a Manager on every doc inside it. Do
> not assume the role is document-scoped.

### Optional: probe individual capabilities for fine-grained UI

If a view needs to toggle one specific control, probe that exact permission
instead of hard-coding from the role. This is the most future-proof approach
(if backend perms change, your UI follows):

| UI capability                         | `permission=` to probe         |
|---------------------------------------|--------------------------------|
| Show the editor (can type)            | `can_edit_direct`              |
| Show "Submit for review" button       | `can_submit_for_approval`      |
| Show Approve/Reject controls          | `can_give_final_approval`      |
| Show "Manage members / Share roles"   | `can_manage_members`           |
| Show comments / discussion surface    | `can_suggest`                  |
| Show version history                  | `can_view_history`             |

Batch these with `Promise.all` on document open and cache the result in your
document store. (Each is an independent GET; fire them in parallel.)

---

## 3. The four views — what each one shows and which APIs it calls

Build these as **distinct view components**, not a greyed-out shared editor (per
the spec: "custom views that only provide options for their specific purpose").
Gate the whole view on the role resolved in §2.

### 3.1 VIEWER view (backend `viewer`)
Least privilege. Read-only.
- **Render:** the document content **read-only** (no toolbar, no slash menu, no
  caret). Show only the **latest saved** content. Viewer must NOT see comments,
  the comment composer, suggestions, or version history beyond the current one.
- **Allowed APIs:**
  - `GET /documents/:id` — load metadata.
  - `GET /documents/:id/export?format=md|docx` — export (Viewer's only action).
    Wired in [export.ts](frontend/src/lib/api/export.ts) (`exportDocument`,
    `downloadDocument`).
  - `PUT/DELETE /documents/:id/star` — personal bookmark is allowed for viewers
    (backend requires only `can_view_history`). Optional.
- **Do NOT call (will 403):** comments, suggestions, submit-for-approval,
  approve/reject, assignments, PATCH/DELETE document. Hide all of these.
- Backend already enforces this: commenting requires `can_suggest`, which viewer
  lacks → 403. But hide it so the user never hits the error.

### 3.2 COLLABORATOR view (backend `editor`)
Editor without approval authority.
- **Render:** full editor (toolbar, slash menu, typing), comments/discussion
  surface, AI assistant, version history.
- **Allowed APIs:**
  - Edit content: live editing flows over the Hocuspocus WebSocket (`/collab/:doc_id`)
    — **not REST** (still unwired backend-wide; see §8). Metadata edits (rename)
    go through `PATCH /documents/:id` (§5).
  - `POST /documents/:id/submit-for-approval` — submit a version for Manager review.
    Wired in [versions.ts](frontend/src/lib/api/versions.ts) (`submitForApproval`).
  - `GET /documents/:id/versions`, `GET /versions/:id` — history.
  - `GET /documents/:id/comments`, `POST /documents/:id/comments`,
    `PATCH /comments/:id/resolve` — discussion (requires `can_suggest`, editor has it).
  - **Read Manager feedback:** `GET /versions/:id/recommendations` and
    `GET /recommendations/:id/responses`; reply with
    `POST /recommendations/:id/responses` (requires `can_suggest`). See §4.
  - `GET /notifications?unread=true` etc.
- **Hide:** Approve/Reject controls, member management. (Backend 403s them anyway.)
- **Key UI:** a prominent **"Submit for review"** action, and a **feedback inbox**
  showing recommendations from the Manager who approved/declined their submission.

### 3.3 MANAGER view (backend `owner`, non-creator)
Editor + approver + member-manager.
- Everything the Collaborator view has, PLUS:
  - **Approve/Reject submissions** — see §4.
  - **Member management** — assign/revoke roles — see §6.
- **Allowed APIs (in addition to Collaborator set):**
  - `POST /versions/:id/approve`, `POST /versions/:id/reject` — wired in
    [versions.ts](frontend/src/lib/api/versions.ts) (`approveVersion`, `rejectVersion`).
  - `POST /versions/:id/recommendations` — the **feedback box** content (§4).
  - `POST /assignments`, `DELETE /assignments/:id`, `GET /assignments?scope_type=document&scope_id=:id` — member management (§6).
  - `GET /roles` — list assignable roles (§6).
  - `POST /documents/:id/transfer-ownership` — hand off / self-demote (§6).
  - `DELETE /documents/:id` — permanent delete (Manager/owner only; §5).

### 3.4 OWNER view (backend `owner` AND `document.created_by === me`)
Identical capability surface to Manager (Owner defaults to Manager hierarchy).
The ONLY differences are presentation + the self-demote affordance:
- Show an **"Owner"** badge instead of "Manager".
- Show **"Transfer ownership / Demote myself"** control (§6). After the Owner
  demotes themselves below Manager, the backend stops granting them
  `can_manage_members`, so on next `getMyAccess()` they resolve to
  Collaborator/Viewer and **cannot re-promote themselves** — exactly the
  irreversibility your spec requires. No special client logic needed; it falls
  out of the RBAC.

---

## 4. Approval + mandatory feedback flow (the heart of the spec)

Your spec: a Collaborator submits a version; a Manager approves (→ stored as a
fixed version) or declines (→ notified as declined); **either way a feedback box
pops up** asking the Manager for feedback; the Collaborator can read that feedback.

Here is how that maps to the existing backend (read `backend/app/api/versions.py`
and `recommendations.py`):

### Step 1 — Collaborator submits
```
POST /api/documents/{id}/submit-for-approval
body: {}   (SubmitForApprovalRequest)
→ 200 { version_id, version_no, message }
```
Backend freezes a snapshot as a `Version` with `kind="submission"` and flips
`document.status` to `"pending_approval"`. Requires `can_submit_for_approval`.
Conflicts: 409 if already pending or if the doc is trashed.

### Step 2 — Manager decides (single-gate path; policy chains are optional, §8)
```
POST /api/versions/{versionId}/approve   body: {} (ApprovalRequest)
POST /api/versions/{versionId}/reject    body: {} (RejectRequest)
```
- **Approve** (NULL policy → single owner gate): requires `can_give_final_approval`.
  Backend mints an `ApprovalMarker` (the **fixed/baseline approved version**),
  sets `version.kind="approved"`, advances `document.current_version_no`, and
  returns `document.status` to `"working"`.
- **Reject**: sets `version.kind="rejected"`, baseline unchanged, doc returns to
  `"working"`.

### Step 3 — The mandatory feedback box (THIS is the piece you build)
The approve/reject endpoints do **not** themselves carry a feedback string. The
backend models feedback as a **Recommendation** attached to the version. So the
flow is **two calls**: decide, then post the feedback.

After the Manager confirms Approve or Reject in your dialog, ALWAYS pop the
feedback box, then:
```
POST /api/versions/{versionId}/recommendations
body: {
  "body": "<the Manager's feedback text>",   // required
  "anchor": { "type": "document" }           // JSONB; use a doc-level anchor if not block-specific
}
→ 201 RecommendationOut { id, document_id, version_id, author_id, body, status, created_at }
```
Requires `can_give_final_approval` (Manager/owner). Do this for **both** approve
and reject so feedback is always captured, per spec.

> Recommended UX: make the feedback box a required field in the same modal as the
> Approve/Reject confirmation; on submit, call decision endpoint first, then the
> recommendation endpoint. If the recommendation POST fails, surface a retry —
> the decision already committed.

### Step 4 — Collaborator reads the feedback
```
GET /api/versions/{versionId}/recommendations
→ 200 { recommendations: RecommendationOut[] }
```
Show these in the Collaborator's **feedback inbox**. The Collaborator can reply
(append-only thread):
```
GET  /api/recommendations/{recId}/responses           → { responses: [...] }
POST /api/recommendations/{recId}/responses  body:{ body }  (requires can_suggest)
```
Manager can mark a recommendation handled:
```
PATCH /api/recommendations/{recId}  body:{ status: "addressed" | "orphaned" | "open" }
```

### ⚠️ Honest gap — "notify the Collaborator as declined"
The version `approve`/`reject` endpoints **do NOT emit a notification** to the
submitter or other collaborators. The only notification the backend writes today
is on `submit-for-approval`, and only when a `approval_policy_id` is attached,
and it goes to the **submitter** (see `versions.py` lines ~161-167). **There is
no backend push for approve/reject decisions.**

So to satisfy "notify collaborators as declined," do it **client-side**:
- After a Collaborator's submission, **poll** `GET /documents/:id/versions` (or
  `GET /versions/:id`) and watch the `kind` field flip from `"submission"` →
  `"approved"` / `"rejected"`. Surface an in-app banner/toast from that, and pull
  the Manager's recommendation (Step 4) as the "feedback / decline reason."
- Also poll `GET /notifications?unread=true` for the submission-pending case.

Do **not** invent a backend notification — that would change backend behavior.
If real-time decline notifications are required later, that's a backend change to
emit a `Notification` in `approve_version`/`reject_version` (flag it back to the
backend agent). For now, polling version `kind` + recommendations is the wiring.

---

## 5. ⭐ WIRE THESE: `PATCH /documents/:id` and `DELETE /documents/:id`

These are the two endpoints you were explicitly told to wire. They are currently
**localStorage mocks** in [documents.ts](frontend/src/lib/api/documents.ts)
(`updateDocument`, `setTrashed`, `deleteForever`). Replace the mock bodies with
real `apiFetch` calls.

### 5.1 `PATCH /api/documents/{id}` — rename / move / trash-restore
Backend handler: `update_document` in `backend/app/api/documents.py`.
**Permission:** `can_edit_direct` on the document (Manager + Collaborator have
it; Viewer does NOT). Moving into a folder also re-checks `can_edit_direct` on
the destination folder.

**Request body** (`DocumentUpdate` — all fields optional, send only what changes):
```ts
interface DocumentUpdate {
  title?: string;        // rename
  folder_id?: string;    // move (UUID); validated to exist in the org
  trashed?: boolean;     // true = move to recycle bin, false = restore
}
```
**Response:** `200` with the full `DocumentResponse` (see §7 shape).

**Critical mapping notes:**
- **`status` is NOT patchable here.** The frontend `DocSummary.status`
  (`"Working" | "Pending Review" | "Approved" | "Draft"`) does **not** exist as a
  writable column. Document status changes ONLY via the approval flow
  (submit → `pending_approval`, approve → `working` w/ new baseline). Do NOT send
  `status` in the PATCH body — it will be ignored at best. Drop the `status` key
  from the mock's `updateDocument` patch when wiring.
- **`trashed: true` is blocked (409)** if the doc is `pending_approval` — reject
  the submission first. Handle the 409 with a clear toast.
- The backend has **no `starred` column** — bookmarks are a separate per-user
  endpoint (`PUT/DELETE /documents/:id/star`). Keep `toggleStar` on the star
  endpoint, NOT on PATCH.

**Reference wiring:**
```ts
// lib/api/documents.ts — replace the mock body of updateDocument()
export async function updateDocument(
  id: string,
  patch: { title?: string; folder_id?: string; trashed?: boolean },
): Promise<DocumentResponse> {
  return apiFetch<DocumentResponse>(`/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch), // send ONLY changed keys; never `status`
  });
}

// setTrashed() becomes a thin wrapper:
export async function setTrashed(id: string, trashed: boolean): Promise<void> {
  await updateDocument(id, { trashed });
}
```

### 5.2 `DELETE /api/documents/{id}` — PERMANENT delete
Backend handler: `delete_document` in `backend/app/api/documents.py`.
**Permission:** `can_manage_members` on the document → **owner/Manager ONLY**.
Collaborators and Viewers do NOT see this action (and get 403 if they try).

- This is the **terminal, irreversible** path (sets `status="deleted"`, hidden
  from every list forever). It is DIFFERENT from the reversible recycle bin
  (`PATCH {trashed:true}`).
- **Blocked (409)** if the doc is `pending_approval` — reject the submission first.
- Returns **`204 No Content`** (no body). `apiFetch` already handles 204.

**Reference wiring:**
```ts
// lib/api/documents.ts — replace the mock body of deleteForever()
export async function deleteForever(id: string): Promise<void> {
  await apiFetch<void>(`/documents/${id}`, { method: "DELETE" });
}
```

**UI rule:** Show "Move to trash" (PATCH `trashed:true`) to Manager + Collaborator.
Show "Delete forever" (DELETE) **only in the Manager/Owner view**, behind a
confirm dialog ("This cannot be undone"). Gate it on a `can_manage_members`
probe (§2), and still catch a 403 as a fallback.

### 5.3 Reconcile the document data model while wiring
Per `INTEGRATION_CHANGES.md` §4, the mock `DocumentRecord` has fields the backend
doesn't (`version` string, `status` labels, `ownerId`, `collaboratorCount`,
`updatedLabel`). Build a mapping layer when wiring list/get/patch:
- `ownerId` → derive from `created_by`.
- `starred` → comes back on `DocumentResponse.starred` (per-user) — keep it.
- `status` label → derive from backend `status` (`working` / `pending_approval`)
  + version `kind`, not from a writable field.
- `collaboratorCount` → `GET /assignments?scope_type=document&scope_id=:id` length.

---

## 6. Member management, ownership, and self-demotion (Manager/Owner only)

### 6.1 List who can be assigned & current members
```
GET /api/roles
→ { roles: [{ id, name, permissions }] }   // name ∈ owner/approver/editor/viewer
GET /api/users
→ { users: [{ id, email, display_name, avatar_color, status, created_at }] }
GET /api/assignments?scope_type=document&scope_id={docId}
→ { assignments: [{ id, user_id, role_id, role_name }] }
```
Use `GET /roles` to resolve the `role_id` for the backend name you want to grant
(map your UI role via `toBackendRole`, then find that role's `id`).

### 6.2 Assign a role to a user on a document
```
POST /api/assignments
body: { user_id, role_id, scope_type: "document", scope_id: docId }
→ 201 { id, user_id, role_id, scope_type, scope_id }
```
- **Escalation guard:** the caller must already hold `can_manage_members` on the
  scope → only Manager/Owner can assign. Manager assigning `owner` (= your
  "Manager") to someone is allowed (multiple owners are fine).
- **409** if that user already has an assignment on this exact scope — to *change*
  an existing member's role you must `DELETE` their assignment then `POST` the new
  one (there is no PATCH on assignments), OR use transfer-ownership for the owner
  case (§6.4). Order matters: the `UNIQUE(user_id, scope_type, scope_id)`
  constraint means delete-then-add.

### 6.3 Revoke a member
```
DELETE /api/assignments/{assignmentId}   → 204
```
- Requires `can_manage_members`.
- **Last-owner guard (409):** the backend refuses to remove the **only** owner of
  a scope (would orphan it). Surface that message; tell the Manager to assign
  another owner first.

### 6.4 Transfer ownership / Owner self-demotion
```
POST /api/documents/{id}/transfer-ownership
body: { to_user_id, demote_to: "editor" | "viewer" | "approver" }
→ 200 { success, message, new_owner_id, previous_owner_id, demoted_to, ... }
```
This is the **atomic, safe** path for an Owner to step down: it grants the target
the `owner` role AND demotes the caller to `demote_to` in one transaction
(document-scoped — folder-level grants untouched). Requires `can_manage_members`.

**Wiring "Owner demotes himself" (spec):**
- The Owner picks a new Manager/Owner (`to_user_id`) and a role to drop to
  (`demote_to`). After the call, the Owner no longer has `can_manage_members` on
  the doc, so the next `getMyAccess()` resolves them to Collaborator/Viewer and
  the management UI disappears. They **cannot re-promote themselves** — matches
  the spec ("once demoted, cannot re-assign his role").
- Backend has no "demote myself without naming a successor" endpoint (the
  last-owner guard prevents orphaning). So the self-demote UX **must** require
  choosing a successor. If other owners already exist, you may instead
  `DELETE /assignments/{myAssignmentId}` then `POST` a lower role — but
  transfer-ownership is the clean, guarded path; prefer it.

### 6.5 Org-level note
Editing *another user's* profile/status (`PATCH /api/users/:id`) requires
**org-admin** (an org-scoped `owner` assignment), which is separate from
document ownership. Per-document Managers do NOT get this. Keep profile editing
out of the document views unless the user is the org admin.

---

## 7. Response shapes you'll bind to

```ts
// DocumentResponse (GET/PATCH /documents/:id, POST /documents)
interface DocumentResponse {
  id: string;
  folder_id: string | null;
  title: string;
  status: "working" | "pending_approval" | "deleted";
  current_version_no: number;
  yjs_doc_key: string;
  starred: boolean;          // THIS user's personal bookmark
  trashed: boolean;
  created_by: string;        // use to detect Owner (§6) and derive ownerId
  created_at: string;        // ISO
  updated_at: string;        // ISO
}

// VersionResponse (GET /documents/:id/versions)
interface DocVersion {
  id: string; document_id: string; version_no: number;
  kind: "submission" | "approved" | "rejected";  // watch this for decisions
  created_by: string; created_at: string;
}

// AuthorizeCheckResponse — see §2
// RecommendationOut — see §4
// AssignmentListEntry: { id, user_id, role_id, role_name }
```

---

## 8. Known gaps & deferred-by-design (do NOT try to wire these)

Per `INTEGRATION_CHANGES.md` §0b, these are intentionally backend-deferred — your
views should degrade gracefully, not error:

1. **Live editing content** flows over **Hocuspocus WebSocket** (`/collab/:doc_id`),
   not REST. The editor body sync is unwired backend-wide. Your role views still
   control *who sees the editing surface*; the actual collab transport is separate.
2. **Approve/Reject notifications** are not emitted (§4). Use client polling of
   version `kind` + recommendations.
3. **Multi-step approval policy chains** (`approval_policy_id`) exist
   (`POST /versions/:id/approve` handles them) but for v1 you can rely on the
   **single owner gate** (NULL policy). If a doc has a policy attached, the
   approve endpoint enforces step roles server-side — just surface its
   success/error messages.
4. **AI suggest/apply, S3 blobs, diff engine, export serializers** return
   placeholders; the contracts hold. Export gives you `content` + `file_name`
   strings — render/download those.
5. **`restore` semantics mismatch:** `POST /versions/:id/restore` is
   *section-scoped* in the backend (`RestoreRequest.section_id`), but the version
   dialog uses it for whole-snapshot restore. `versions.ts` sends
   `section_id="full"` as a stopgap. Don't redesign this for the role views.

---

## 9. Build checklist for the Frontend Agent

- [ ] Add `lib/roles.ts` with `toUiRole` / `toBackendRole` mapping (§0).
- [ ] Add `getMyAccess(docId)` calling `authorize-check` (§2); cache in doc store.
- [ ] On document open: resolve UI role, then render the matching view component
      (Viewer / Collaborator / Manager / Owner) — separate components, not greyed-out.
- [ ] **Wire `PATCH /documents/:id`** in `documents.ts` `updateDocument` — title /
      folder_id / trashed only, NEVER status (§5.1).
- [ ] **Wire `DELETE /documents/:id`** in `documents.ts` `deleteForever` — Manager/
      Owner only, confirm dialog, handle 409 pending-approval (§5.2).
- [ ] Keep star on `PUT/DELETE /documents/:id/star`, not PATCH (§5.1).
- [ ] Collaborator: "Submit for review" → `submit-for-approval`; feedback inbox
      from `GET /versions/:id/recommendations` (§3.2, §4).
- [ ] Manager: Approve/Reject modal → decision endpoint THEN mandatory
      `POST /versions/:id/recommendations` feedback box (§4).
- [ ] Manager/Owner: member panel (roles + users + assignments CRUD) and
      transfer-ownership / self-demote (§6).
- [ ] Viewer: read-only render, export only, NO comments/history/edit (§3.1).
- [ ] Poll version `kind` + recommendations for approve/reject surfacing (§4 gap).
- [ ] Treat every 403 as "view should have hidden this" — fail soft with a toast.
- [ ] Mirror any new endpoint shapes in `frontend/src/mocks/handlers.ts` for MSW.
```
