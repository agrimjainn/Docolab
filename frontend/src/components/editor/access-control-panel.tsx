"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import * as access from "@/lib/api/assignments";
import * as auth from "@/lib/api/auth";
import { type UiRole, toUiRole } from "@/lib/roles";
import { useDocumentOptional } from "@/lib/store/document-store";

// Roles a Manager can assign directly. Ownership is NOT here — it moves only via
// the atomic transfer-ownership action (which also demotes the previous owner).
const ASSIGNABLE: UiRole[] = ["Manager", "Collaborator", "Viewer"];

interface MemberRow {
  assignmentId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string; // backend role name (owner/approver/editor/viewer)
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * REAL backend access control (frontend_instructions.md §6). Loads the
 * document's assignments + org roster and lets a Manager/Owner assign, change,
 * revoke roles and transfer ownership — all hitting the live FastAPI endpoints.
 * If the backend is unreachable it calls `onUnavailable` so the parent can fall
 * back to the local share UI.
 */
export function AccessControlPanel({
  docId,
  onUnavailable,
}: {
  docId: string;
  onUnavailable: () => void;
}) {
  const ctx = useDocumentOptional();
  const canManage = ctx?.caps?.canManageMembers ?? false;
  const me = auth.getCurrentUser();

  const [members, setMembers] = React.useState<MemberRow[] | null>(null);
  const [roster, setRoster] = React.useState<access.OrgUser[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const [assignments, users] = await Promise.all([
        access.listAssignments(docId),
        access.listOrgUsers().catch(() => [] as access.OrgUser[]),
      ]);
      const byId = new Map(users.map((u) => [u.id, u]));
      const rows: MemberRow[] = assignments.map((a) => {
        const u = byId.get(a.user_id);
        return {
          assignmentId: a.id,
          userId: a.user_id,
          name: u?.display_name ?? a.user_id,
          email: u?.email ?? "",
          roleName: a.role_name,
        };
      });
      setMembers(rows);
      setRoster(users);
    } catch {
      // Backend not reachable / unauthenticated — let the parent show the mock.
      onUnavailable();
    }
  }, [docId, onUnavailable]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const assigned = new Set((members ?? []).map((m) => m.userId));
  const addable = roster.filter((u) => !assigned.has(u.id));

  const addMember = async (userId: string, role: UiRole) => {
    setBusy(true);
    try {
      await access.assignRole(docId, userId, role);
      toast.success(`Added as ${role}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add member");
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (m: MemberRow, role: UiRole) => {
    setBusy(true);
    try {
      await access.changeRole(docId, m.userId, m.assignmentId, role);
      toast.success(`${m.name} is now ${role}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change role");
      await load(); // reconcile (revoke may have applied before assign failed)
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (m: MemberRow) => {
    setBusy(true);
    try {
      await access.revokeAssignment(m.assignmentId);
      toast.success(`Removed ${m.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove member");
    } finally {
      setBusy(false);
    }
  };

  const transfer = async (m: MemberRow, demoteTo: "editor" | "viewer") => {
    if (
      !window.confirm(
        `Make ${m.name} the owner and step yourself down to ${
          demoteTo === "editor" ? "Collaborator" : "Viewer"
        }? You won't be able to re-promote yourself.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await access.transferOwnership(docId, m.userId, demoteTo);
      toast.success(res.message || "Ownership transferred");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not transfer ownership");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3">
      <p className="px-3 pb-1 font-ui-xs text-ui-xs text-text-muted">People with access</p>

      {!members && (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-surface-container" />
          ))}
        </div>
      )}

      <div className="max-h-56 overflow-y-auto">
        {members?.map((m) => {
          const isOwner = m.roleName === "owner";
          const isSelf = me?.id === m.userId;
          const uiLabel = toUiRole(m.roleName as never, isOwner && isSelf) ?? "Viewer";
          return (
            <div
              key={m.assignmentId}
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-container-low"
            >
              <Avatar size="sm">
                <AvatarFallback>{initials(m.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-ui-sm text-ui-sm font-medium text-text-primary">
                  {m.name}
                  {isSelf && " (you)"}
                </p>
                {m.email && (
                  <p className="truncate font-ui-xs text-ui-xs text-text-muted">{m.email}</p>
                )}
              </div>

              {/* Owners are managed via transfer; everyone else via the dropdown. */}
              {isOwner || !canManage ? (
                <span className="px-2 font-ui-sm text-ui-sm text-text-muted">{uiLabel}</span>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy}
                    className="flex items-center gap-1 rounded-md px-2 py-1 font-ui-sm text-ui-sm text-text-secondary outline-none hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary-container"
                  >
                    {uiLabel}
                    <Icon name="expand_more" size={16} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {ASSIGNABLE.map((r) => (
                      <DropdownMenuItem key={r} onSelect={() => void changeRole(m, r)}>
                        <span className="flex-1">{r}</span>
                        {uiLabel === r && <Icon name="check" size={16} />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {/* Transfer ownership to this member (steps the caller down). */}
                    <DropdownMenuItem onSelect={() => void transfer(m, "editor")}>
                      <Icon name="shield_person" size={16} className="text-text-muted" />
                      <span className="flex-1">Make owner (I become Collaborator)</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void transfer(m, "viewer")}>
                      <Icon name="shield_person" size={16} className="text-text-muted" />
                      <span className="flex-1">Make owner (I become Viewer)</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void revoke(m)}>
                      Remove access
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
        {members?.length === 0 && (
          <p className="px-3 py-4 text-center font-ui-xs text-ui-xs text-text-muted">
            No direct members yet. Add someone below.
          </p>
        )}
      </div>

      {/* Add a person from the org roster. */}
      {canManage && addable.length > 0 && (
        <div className="mt-2 border-t border-border-subtle px-3 pt-3 pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border-subtle px-3 py-2 font-ui-sm text-ui-sm font-medium text-text-secondary outline-none transition-colors hover:bg-surface-container"
            >
              <Icon name="person_add" size={18} />
              Add a person
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 min-w-64 overflow-y-auto">
              {addable.map((u) => (
                <RosterRow key={u.id} user={u} onPick={addMember} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

/** A roster entry with quick role-pick buttons (M / C / V). */
function RosterRow({
  user,
  onPick,
}: {
  user: access.OrgUser;
  onPick: (userId: string, role: UiRole) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Avatar size="sm">
        <AvatarFallback>{initials(user.display_name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-ui-sm text-ui-sm font-medium text-text-primary">
          {user.display_name}
        </p>
        <p className="truncate font-ui-xs text-ui-xs text-text-muted">{user.email}</p>
      </div>
      <div className="flex gap-1">
        {ASSIGNABLE.map((r) => (
          <button
            key={r}
            title={`Add as ${r}`}
            onClick={() => void onPick(user.id, r)}
            className={cn(
              "rounded px-1.5 py-0.5 font-ui-xs text-ui-xs font-semibold text-text-secondary transition-colors hover:bg-accent-bg hover:text-primary-container",
            )}
          >
            {r[0]}
          </button>
        ))}
      </div>
    </div>
  );
}
