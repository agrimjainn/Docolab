// =============================================================================
// lib/roles.ts — role mapping + capability derivation for role-based views.
//
// The UI uses Owner / Manager / Collaborator / Viewer. The backend has a FIXED
// seeded role set with DIFFERENT names: owner / approver / editor / viewer
// (see backend/app/main.py ROLE_PERMISSIONS, and frontend_instructions.md §0).
// This module is the single place that maps between them and derives the
// per-role capability flags the views switch on.
//
// AUTHORITY: the backend is the only real gate (every mutating call is
// re-checked server-side, returning 403). These caps are UX only — they decide
// which view/controls to SHOW, never whether an action is permitted.
// =============================================================================

import { apiFetch } from "@/lib/api/client";

export type BackendRole = "owner" | "approver" | "editor" | "viewer";
export type UiRole = "Owner" | "Manager" | "Collaborator" | "Viewer";

/** What a role may DO — drives which view + controls render. */
export interface Caps {
  canEdit: boolean; // can type in the editor (can_edit_direct)
  canComment: boolean; // discussion surface (can_suggest)
  canSubmit: boolean; // submit a version for review (can_submit_for_approval)
  canApprove: boolean; // approve/reject submissions (can_give_final_approval)
  canManageMembers: boolean; // assign/revoke roles (can_manage_members)
  canViewHistory: boolean; // version history (can_view_history)
  canDelete: boolean; // permanent delete (DELETE /documents/:id → can_manage_members)
  canExport: boolean; // export (backend gate is can_view_history)
}

/** Capability table mirroring the backend seed. The single source of truth for
 *  "what can this role do" on the client. Keep in sync with ROLE_PERMISSIONS. */
const ROLE_CAPS: Record<BackendRole, Caps> = {
  owner: {
    canEdit: true, canComment: true, canSubmit: true, canApprove: true,
    canManageMembers: true, canViewHistory: true, canDelete: true, canExport: true,
  },
  approver: {
    // Reviewer that can also edit, but cannot manage members or delete.
    canEdit: true, canComment: true, canSubmit: true, canApprove: true,
    canManageMembers: false, canViewHistory: true, canDelete: false, canExport: true,
  },
  editor: {
    canEdit: true, canComment: true, canSubmit: true, canApprove: false,
    canManageMembers: false, canViewHistory: true, canDelete: false, canExport: true,
  },
  viewer: {
    canEdit: false, canComment: false, canSubmit: false, canApprove: false,
    canManageMembers: false, canViewHistory: true, canDelete: false, canExport: true,
  },
};

/** A user with NO access to a document. */
export const NO_CAPS: Caps = {
  canEdit: false, canComment: false, canSubmit: false, canApprove: false,
  canManageMembers: false, canViewHistory: false, canDelete: false, canExport: false,
};

export function capsForRole(role: BackendRole | null): Caps {
  return role ? ROLE_CAPS[role] : NO_CAPS;
}

/** backend role name -> UI label. `isCreator` splits Owner from Manager. */
export function toUiRole(role: BackendRole | null, isCreator: boolean): UiRole | null {
  switch (role) {
    case "owner":
      return isCreator ? "Owner" : "Manager";
    case "approver":
      return "Manager"; // optional middle tier — treat as Manager-lite
    case "editor":
      return "Collaborator";
    case "viewer":
      return "Viewer";
    default:
      return null; // no access
  }
}

/** UI label -> backend role name to send when assigning (Owner & Manager → owner). */
export function toBackendRole(ui: UiRole): "owner" | "editor" | "viewer" {
  if (ui === "Owner" || ui === "Manager") return "owner";
  if (ui === "Collaborator") return "editor";
  return "viewer";
}

interface AuthorizeCheckResponse {
  allowed: boolean;
  resolved_role: BackendRole | null;
  via_scope: string | null;
}

export interface MyAccess {
  backendRole: BackendRole | null;
  viaScope: string | null; // null = no access (or backend unreachable)
}

/**
 * Resolve the current user's effective backend role on a document via the
 * backend's authorize-check (which runs the same authorize() the mutating
 * endpoints run, including folder inheritance).
 *
 * One probe with can_view_history is enough: every role with ANY access holds
 * it, so resolved_role is populated for owner/editor/viewer alike.
 */
export async function getMyAccess(docId: string): Promise<MyAccess> {
  const res = await apiFetch<AuthorizeCheckResponse>(
    `/documents/${docId}/authorize-check?permission=can_view_history`,
  );
  return {
    backendRole: res.resolved_role,
    viaScope: res.allowed ? res.via_scope : null,
  };
}
