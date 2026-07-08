// =============================================================================
// lib/api/admin.ts  —  typed client for the Docolab Admin panel.
//
// Wraps the backend `/api/admin/*` cluster (see backend/app/api/admin.py) plus
// the two shared endpoints the admin UI leans on: `/folders` (list/create) and
// `/presence/heartbeat`. Everything goes through apiFetch() so auth + silent
// refresh are shared with the rest of the app.
//
// Admin auth note: admin sign-in is a DIFFERENT entry point (`/admin/login`,
// rejects non-admins with 403) but issues the SAME token pair as normal login,
// so once signed in every other apiFetch call is authenticated identically.
// =============================================================================

import { apiFetch, setToken, setRefreshToken } from "@/lib/api/client";

// Presence heartbeat lives in its own module (shared with the user app); the
// admin guard imports it from here for convenience.
export { heartbeat } from "@/lib/api/presence";

// --- role mapping (UI label <-> backend role name) --------------------------
// Owner->owner, Manager->approver, Collaborator->editor, Viewer->viewer.
export type BackendRole = "owner" | "approver" | "editor" | "viewer";
export const ROLE_LABELS: Record<BackendRole, string> = {
  owner: "Owner",
  approver: "Manager",
  editor: "Collaborator",
  viewer: "Viewer",
};
export const ROLE_OPTIONS: BackendRole[] = ["owner", "approver", "editor", "viewer"];
export const DEFAULT_ROLE: BackendRole = "editor"; // UI "Collaborator"
export function roleLabel(role?: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role as BackendRole] ?? role;
}

// --- shapes (mirror app/schemas/admin.py) -----------------------------------
export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  avatar_color?: string | null;
  status: string; // "active" | "disabled"
  online: boolean;
  last_seen_at?: string | null;
  created_at: string;
}

export interface AdminDoc {
  id: string;
  title: string;
  status: string;
  folder_id?: string | null;
  ai_model: string;
  trashed: boolean;
  created_by: string;
  creator_email?: string | null;
  creator_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocAccessEntry {
  user_id: string;
  email: string;
  display_name: string;
  role_id?: string | null;
  role_name?: BackendRole | null;
  is_creator: boolean;
}

export interface FolderCheckItem {
  folder_id: string;
  name: string;
  checked: boolean;
  is_primary: boolean;
}

export interface DocFolders {
  document_id: string;
  primary_folder_id?: string | null;
  folders: FolderCheckItem[];
}

export interface AiModelItem {
  id: string;
  vendor: string;
  model_key: string;
  display_name: string;
  enabled: boolean;
  is_default: boolean;
}

export interface UsageByModelItem {
  vendor: string;
  model_key: string;
  display_name?: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  call_count: number;
  pct: number;
}

export interface UsageByModelResponse {
  unit: string; // "tokens"
  total_tokens: number;
  models: UsageByModelItem[];
}

export interface UsageByDocumentItem {
  document_id?: string | null;
  title?: string | null;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  call_count: number;
}

export interface UsageByDocumentResponse {
  unit: string;
  documents: UsageByDocumentItem[];
}

export interface Folder {
  id: string;
  name: string;
  parent_folder_id?: string | null;
}

interface Token {
  user: AdminUser | { id: string; email: string; display_name: string };
  token: string;
  refresh_token: string;
}
interface OkResponse {
  success: boolean;
  message: string;
}

// --- auth (requirement 7) ---------------------------------------------------

/** Admin sign-in. Stores tokens on success; throws ApiError (401 bad creds /
 *  403 not an admin) otherwise. */
export async function adminLogin(email: string, password: string): Promise<AdminUser> {
  const res = await apiFetch<Token>("/admin/login", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  setToken(res.token);
  setRefreshToken(res.refresh_token);
  return res.user as AdminUser;
}

/** Confirm the current session belongs to an admin (used by the guard). */
export function adminMe(): Promise<AdminUser> {
  return apiFetch<AdminUser>("/admin/me");
}

// --- users + presence (requirements 4, 5, 12) -------------------------------

export async function listUsers(): Promise<AdminUser[]> {
  const r = await apiFetch<{ users: AdminUser[] }>("/admin/users");
  return r.users;
}

/** List (active) or delist (disabled) a member. */
export function setMembership(userId: string, active: boolean): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/admin/users/${userId}/membership`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
}

export async function userDocuments(userId: string): Promise<AdminDoc[]> {
  const r = await apiFetch<{ documents: AdminDoc[] }>(`/admin/users/${userId}/documents`);
  return r.documents;
}

/** Requirement 13: assign a document to a user with a role (default editor). */
export function assignDocumentToUser(
  userId: string,
  documentId: string,
  role: BackendRole = DEFAULT_ROLE,
): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/admin/users/${userId}/assign-document`, {
    method: "POST",
    body: JSON.stringify({ document_id: documentId, role }),
  });
}

/** Requirement 4 (add): create a new org member. */
export function createUser(input: {
  email: string;
  display_name: string;
  password: string;
  avatar_color?: string;
}): Promise<AdminUser> {
  return apiFetch<AdminUser>("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      display_name: input.display_name.trim(),
      password: input.password,
      avatar_color: input.avatar_color,
    }),
  });
}

// --- documents: org-wide list + search (requirements 1, 3) ------------------

export async function listDocuments(opts: {
  q?: string;
  folderId?: string;
  trashed?: boolean;
} = {}): Promise<AdminDoc[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.folderId) params.set("folder_id", opts.folderId);
  if (opts.trashed !== undefined) params.set("trashed", String(opts.trashed));
  const qs = params.toString();
  const r = await apiFetch<{ documents: AdminDoc[] }>(`/admin/documents${qs ? `?${qs}` : ""}`);
  return r.documents;
}

// --- per-document access / roles (requirements 2, 8, 9, 13) -----------------

export async function docAccess(docId: string): Promise<DocAccessEntry[]> {
  const r = await apiFetch<{ document_id: string; entries: DocAccessEntry[] }>(
    `/admin/documents/${docId}/access`,
  );
  return r.entries;
}

/** Set/change a user's role on a doc (creates the assignment if absent). */
export function upsertDocAccess(
  docId: string,
  userId: string,
  role: BackendRole,
): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/admin/documents/${docId}/access`, {
    method: "PUT",
    body: JSON.stringify({ user_id: userId, role }),
  });
}

export function removeDocAccess(docId: string, userId: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/admin/documents/${docId}/access/${userId}`, {
    method: "DELETE",
  });
}

// --- multi-folder placement (requirement 6) ---------------------------------

export function docFolders(docId: string): Promise<DocFolders> {
  return apiFetch<DocFolders>(`/admin/documents/${docId}/folders`);
}

/** Replace the doc's EXTRA folder placements (primary is always implied). */
export function setDocFolders(docId: string, folderIds: string[]): Promise<DocFolders> {
  return apiFetch<DocFolders>(`/admin/documents/${docId}/folders`, {
    method: "PUT",
    body: JSON.stringify({ folder_ids: folderIds }),
  });
}

// --- per-document AI model + catalog (requirement 11) -----------------------

export function setDocAiModel(docId: string, aiModel: string): Promise<{ document_id: string; ai_model: string }> {
  return apiFetch(`/admin/documents/${docId}/ai-model`, {
    method: "PUT",
    body: JSON.stringify({ ai_model: aiModel }),
  });
}

export async function listAiModels(): Promise<AiModelItem[]> {
  const r = await apiFetch<{ models: AiModelItem[] }>("/admin/ai/models");
  return r.models;
}

// --- AI usage metering (Model Usage section) --------------------------------

export function usageByModel(days?: number): Promise<UsageByModelResponse> {
  const qs = days ? `?days=${days}` : "";
  return apiFetch<UsageByModelResponse>(`/admin/ai/usage/by-model${qs}`);
}

export function usageByDocument(limit = 5, days?: number): Promise<UsageByDocumentResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (days) params.set("days", String(days));
  return apiFetch<UsageByDocumentResponse>(`/admin/ai/usage/by-document?${params.toString()}`);
}

// --- shared: folders + document creation (requirements 6, 8) ----------------

export async function listFolders(): Promise<Folder[]> {
  const r = await apiFetch<{ folders: Folder[] }>("/folders");
  return r.folders;
}

export function createFolder(name: string, parentFolderId?: string | null): Promise<Folder> {
  return apiFetch<Folder>("/folders", {
    method: "POST",
    body: JSON.stringify({ name, parent_folder_id: parentFolderId ?? null }),
  });
}

/** Admin acting as a normal user (requirement 8): create a document. */
export function createDocument(title: string, folderId?: string | null): Promise<AdminDoc> {
  return apiFetch<AdminDoc>("/documents", {
    method: "POST",
    body: JSON.stringify({ title, folder_id: folderId ?? null }),
  });
}

/** Move a document to the recycle bin (admin delete). */
export function trashDocument(docId: string): Promise<unknown> {
  return apiFetch(`/documents/${docId}`, {
    method: "PATCH",
    body: JSON.stringify({ trashed: true }),
  });
}
