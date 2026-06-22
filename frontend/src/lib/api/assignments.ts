// =============================================================================
// lib/api/assignments.ts — real role assignment (access control) for the Share
// menu. Wraps the FastAPI roles/assignments/users endpoints
// (frontend_instructions.md §6). Manager/Owner-only on the server.
//
//   GET    /roles                                    list assignable roles
//   GET    /users                                    org roster
//   GET    /assignments?scope_type=document&scope_id current members
//   POST   /assignments                              grant a role
//   DELETE /assignments/:id                          revoke
//
// There is NO PATCH on assignments — to CHANGE a member's role you delete the
// old assignment and create a new one (UNIQUE(user_id, scope, scope_id)).
// =============================================================================

import { apiFetch } from "@/lib/api/client";
import type { UiRole } from "@/lib/roles";
import { toBackendRole } from "@/lib/roles";

export interface BackendRoleRow {
  id: string;
  name: "owner" | "approver" | "editor" | "viewer";
  permissions?: string[];
}

export interface OrgUser {
  id: string;
  email: string;
  display_name: string;
  avatar_color?: string | null;
  status?: string;
}

export interface AssignmentEntry {
  id: string;
  user_id: string;
  role_id: string;
  role_name: string;
}

export async function listRoles(): Promise<BackendRoleRow[]> {
  const data = await apiFetch<{ roles: BackendRoleRow[] }>(`/roles`);
  return data.roles;
}

export async function listOrgUsers(): Promise<OrgUser[]> {
  const data = await apiFetch<{ users: OrgUser[] }>(`/users`);
  return data.users;
}

export async function listAssignments(docId: string): Promise<AssignmentEntry[]> {
  const data = await apiFetch<{ assignments: AssignmentEntry[] }>(
    `/assignments?scope_type=document&scope_id=${encodeURIComponent(docId)}`,
  );
  return data.assignments;
}

/** Resolve the backend role row id for a UI role label. */
async function roleIdFor(ui: UiRole): Promise<string> {
  const wanted = toBackendRole(ui); // "owner" | "editor" | "viewer"
  const roles = await listRoles();
  const row = roles.find((r) => r.name === wanted);
  if (!row) throw new Error(`Role "${wanted}" not found on the server`);
  return row.id;
}

/** Grant a user a role on the document (POST /assignments). */
export async function assignRole(
  docId: string,
  userId: string,
  ui: UiRole,
): Promise<void> {
  const role_id = await roleIdFor(ui);
  await apiFetch(`/assignments`, {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      role_id,
      scope_type: "document",
      scope_id: docId,
    }),
  });
}

export async function revokeAssignment(assignmentId: string): Promise<void> {
  await apiFetch(`/assignments/${assignmentId}`, { method: "DELETE" });
}

export interface TransferOwnershipResult {
  success: boolean;
  message: string;
  document_id: string;
  new_owner_id: string;
  previous_owner_id: string;
  demoted_to: string;
}

/**
 * Atomically hand document ownership to another user (POST
 * /documents/:id/transfer-ownership). The backend grants the target the owner
 * role FIRST, then demotes the caller to `demoteTo` at the document scope — so
 * the caller (the Owner) cannot re-promote themselves afterwards. This is the
 * safe self-demotion path; the backend forbids transferring to yourself and
 * guards against orphaning the last owner.
 */
export async function transferOwnership(
  docId: string,
  toUserId: string,
  demoteTo: "editor" | "viewer" | "approver",
): Promise<TransferOwnershipResult> {
  return apiFetch<TransferOwnershipResult>(`/documents/${docId}/transfer-ownership`, {
    method: "POST",
    body: JSON.stringify({ to_user_id: toUserId, demote_to: demoteTo }),
  });
}

/**
 * Change a member's role: delete the existing document-scoped assignment, then
 * create the new one (no PATCH exists). Best-effort ordering — if the create
 * fails the caller should refetch to reconcile.
 */
export async function changeRole(
  docId: string,
  userId: string,
  currentAssignmentId: string,
  ui: UiRole,
): Promise<void> {
  await revokeAssignment(currentAssignmentId);
  await assignRole(docId, userId, ui);
}
