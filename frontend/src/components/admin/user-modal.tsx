"use client";

import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { InitialsAvatar } from "@/components/admin/avatar";
import { ApiError } from "@/lib/api/client";
import {
  userDocuments,
  assignDocumentToUser,
  removeDocAccess,
  setMembership,
  ROLE_OPTIONS,
  ROLE_LABELS,
  DEFAULT_ROLE,
  type AdminUser,
  type AdminDoc,
  type BackendRole,
} from "@/lib/api/admin";

// Requirements 4, 10, 13: inspect one user — see the documents they can access,
// assign a document to them with a role (default Collaborator), remove access,
// and list/delist their org membership.
export function UserModal({
  user,
  allDocs,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  allDocs: AdminDoc[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [docs, setDocs] = React.useState<AdminDoc[] | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addQuery, setAddQuery] = React.useState("");
  const [addRole, setAddRole] = React.useState<BackendRole>(DEFAULT_ROLE);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setDocs(await userDocuments(user.id));
  }, [user.id]);

  React.useEffect(() => {
    load().catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed to load"));
  }, [load]);

  const assignedIds = new Set((docs ?? []).map((d) => d.id));
  const addable = allDocs.filter(
    (d) => !assignedIds.has(d.id) && d.title.toLowerCase().includes(addQuery.toLowerCase()),
  );

  const addDoc = async (d: AdminDoc) => {
    try {
      await assignDocumentToUser(user.id, d.id, addRole);
      setAddOpen(false);
      setAddQuery("");
      await load();
      onChanged();
      toast.success(`Assigned "${d.title}" as ${ROLE_LABELS[addRole]}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to assign");
    }
  };

  const removeDoc = async (d: AdminDoc) => {
    try {
      await removeDocAccess(d.id, user.id);
      setDocs((prev) => prev?.filter((x) => x.id !== d.id) ?? prev);
      onChanged();
      toast.success(`Removed access to "${d.title}"`);
    } catch (e) {
      // 404 = the user is the creator (no explicit assignment to drop).
      toast.error(
        e instanceof ApiError && e.status === 404
          ? "User is the creator — access can't be removed here."
          : e instanceof ApiError
            ? e.message
            : "Failed to remove",
      );
    }
  };

  const toggleMembership = async () => {
    const activating = user.status === "disabled";
    if (!activating && !confirm(`Delist ${user.display_name}? They will no longer be able to sign in.`)) return;
    setBusy(true);
    try {
      await setMembership(user.id, activating);
      toast.success(activating ? "User reactivated" : "User delisted");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to update membership");
    } finally {
      setBusy(false);
    }
  };

  const disabled = user.status === "disabled";

  return (
    <div className="gl-overlay" onMouseDown={onClose}>
      <div
        className="gl-card relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[rgba(125,211,252,0.1)] p-6">
          <div className="flex min-w-0 items-center gap-3">
            <InitialsAvatar name={user.display_name} color={user.avatar_color} size={52} online={user.online} />
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-[var(--gl-on-surface)]">
                {user.display_name}
                {disabled && (
                  <span className="rounded bg-[rgba(255,107,107,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--gl-error)]">
                    Delisted
                  </span>
                )}
              </h2>
              <p className="truncate text-xs text-[var(--gl-on-surface-variant)]">{user.email}</p>
              <p className="mt-0.5 text-[11px] text-[var(--gl-on-surface-variant)]">
                {user.online ? "● Online now" : user.last_seen_at ? `Last seen ${new Date(user.last_seen_at).toLocaleString()}` : "Offline"}
              </p>
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button onClick={() => setAddOpen((v) => !v)} className="gl-btn gl-btn-solid px-3 py-1.5 text-xs font-medium">
              <Icon name="add" className="text-[16px]" /> Add Document
            </button>
            <button
              onClick={toggleMembership}
              disabled={busy}
              className={`gl-btn px-3 py-1.5 text-xs font-medium ${disabled ? "gl-btn-solid" : "gl-btn-danger"}`}
            >
              <Icon name={disabled ? "person_check" : "person_remove"} className="text-[16px]" />
              {disabled ? "Reactivate" : "Delist User"}
            </button>
            {addOpen && (
              <div className="gl-card absolute right-0 top-11 z-20 w-80 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Icon
                      name="search"
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-[var(--gl-on-surface-variant)]"
                    />
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={(e) => setAddQuery(e.target.value)}
                      placeholder="Search documents…"
                      className="gl-input w-full rounded-lg py-2 pl-9 pr-3 text-sm"
                    />
                  </div>
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value as BackendRole)}
                    className="gl-select w-28 rounded-lg px-2 py-2 text-xs"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {addable.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-[var(--gl-on-surface-variant)]">No documents</p>
                  ) : (
                    addable.slice(0, 20).map((d) => (
                      <button
                        key={d.id}
                        onClick={() => addDoc(d)}
                        className="gl-row flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left"
                      >
                        <Icon name="description" className="text-lg text-[var(--gl-primary)]" />
                        <span className="truncate text-sm text-[var(--gl-on-surface)]">{d.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Body: assigned documents */}
        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-2 text-sm font-medium text-[var(--gl-on-surface-variant)]">Assigned Documents</p>
          {docs === null ? (
            <div className="flex justify-center py-6">
              <Icon name="progress_activity" className="gl-spin text-xl text-[var(--gl-primary)]" />
            </div>
          ) : docs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[rgba(125,211,252,0.1)] px-3 py-6 text-center text-xs text-[var(--gl-on-surface-variant)]">
              This user has no documents yet.
            </p>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => {
                const isCreator = d.created_by === user.id;
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 rounded-lg border border-[rgba(125,211,252,0.06)] bg-[rgba(26,36,56,0.3)] p-3"
                  >
                    <Icon name="description" className="text-xl text-[var(--gl-primary)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gl-on-surface)]">{d.title}</p>
                      <p className="text-xs text-[var(--gl-on-surface-variant)]">
                        {isCreator ? "Created by this user" : "Shared with this user"}
                      </p>
                    </div>
                    <button
                      onClick={() => removeDoc(d)}
                      disabled={isCreator}
                      title={isCreator ? "Creator — manage in the document panel" : "Remove access"}
                      className="gl-btn gl-btn-ghost h-8 w-8 rounded-lg p-0 disabled:opacity-30"
                    >
                      <Icon name="link_off" className="text-[18px]" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[rgba(125,211,252,0.1)] p-6">
          <button onClick={onClose} className="gl-btn gl-btn-ghost px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
