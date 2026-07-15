"use client";

import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { InitialsAvatar } from "@/components/admin/avatar";
import { ApiError } from "@/lib/api/client";
import {
  docAccess,
  docFolders,
  listAiModels,
  upsertDocAccess,
  removeDocAccess,
  setDocFolders,
  setDocAiModel,
  trashDocument,
  ROLE_OPTIONS,
  ROLE_LABELS,
  roleLabel,
  DEFAULT_ROLE,
  type AdminDoc,
  type AdminUser,
  type DocAccessEntry,
  type FolderCheckItem,
  type AiModelItem,
  type BackendRole,
} from "@/lib/api/admin";

// Requirements 2, 6, 9, 11: manage a single document — AI model, per-user roles
// (incl. the creator), add/remove access, and multi-folder placement.
export function DocumentModal({
  doc,
  users,
  onClose,
  onChanged,
}: {
  doc: AdminDoc;
  users: AdminUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [access, setAccess] = React.useState<DocAccessEntry[] | null>(null);
  const [folders, setFolders] = React.useState<FolderCheckItem[] | null>(null);
  const [primaryFolder, setPrimaryFolder] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<AiModelItem[]>([]);
  const [model, setModel] = React.useState(doc.ai_model);
  const [saving, setSaving] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [addQuery, setAddQuery] = React.useState("");

  const load = React.useCallback(async () => {
    const [a, f, m] = await Promise.all([docAccess(doc.id), docFolders(doc.id), listAiModels()]);
    setAccess(a);
    setFolders(f.folders);
    setPrimaryFolder(f.primary_folder_id ?? null);
    setModels(m);
  }, [doc.id]);

  React.useEffect(() => {
    load().catch((e) => toast.error(e instanceof ApiError ? e.message : "Failed to load document"));
  }, [load]);

  const assignedIds = new Set((access ?? []).map((e) => e.user_id));
  const addable = users.filter(
    (u) =>
      !assignedIds.has(u.id) &&
      (u.display_name.toLowerCase().includes(addQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(addQuery.toLowerCase())),
  );

  const changeRole = async (userId: string, role: BackendRole) => {
    try {
      await upsertDocAccess(doc.id, userId, role);
      setAccess((prev) => prev?.map((e) => (e.user_id === userId ? { ...e, role_name: role } : e)) ?? prev);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to change role");
      load();
    }
  };

  const addUser = async (u: AdminUser) => {
    try {
      await upsertDocAccess(doc.id, u.id, DEFAULT_ROLE);
      setAddOpen(false);
      setAddQuery("");
      await load();
      onChanged();
      toast.success(`${u.display_name} added as ${ROLE_LABELS[DEFAULT_ROLE]}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to add user");
    }
  };

  const remove = async (e: DocAccessEntry) => {
    try {
      await removeDocAccess(doc.id, e.user_id);
      setAccess((prev) => prev?.filter((x) => x.user_id !== e.user_id) ?? prev);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove access");
    }
  };

  const toggleFolder = (fid: string) => {
    setFolders(
      (prev) => prev?.map((f) => (f.folder_id === fid ? { ...f, checked: !f.checked } : f)) ?? prev,
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      if (model !== doc.ai_model) await setDocAiModel(doc.id, model);
      if (folders) {
        // Send the full desired set of extra placements (primary is implied).
        const extra = folders.filter((f) => f.checked && f.folder_id !== primaryFolder).map((f) => f.folder_id);
        await setDocFolders(doc.id, extra);
      }
      toast.success("Document updated");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Move "${doc.title}" to the recycle bin?`)) return;
    try {
      await trashDocument(doc.id);
      toast.success("Document moved to recycle bin");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to delete");
    }
  };

  const checkedFolders = folders?.filter((f) => f.checked) ?? [];

  return (
    <div className="gl-overlay" onMouseDown={onClose}>
      <div
        className="gl-card relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[rgba(125,211,252,0.1)] p-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[rgba(125,211,252,0.1)]">
              <Icon name="description" className="text-2xl text-[var(--gl-primary)]" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-[var(--gl-on-surface)]">{doc.title}</h2>
              <p className="text-xs text-[var(--gl-on-surface-variant)]">
                {doc.creator_name ? `Owner: ${doc.creator_name} · ` : ""}
                Updated {new Date(doc.updated_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="relative flex shrink-0 items-center gap-2">
            <button onClick={() => setAddOpen((v) => !v)} className="gl-btn gl-btn-solid px-3 py-1.5 text-xs font-medium">
              <Icon name="person_add" className="text-[16px]" /> Add User
            </button>
            <button onClick={del} className="gl-btn gl-btn-danger px-3 py-1.5 text-xs font-medium">
              <Icon name="delete" className="text-[16px]" /> Delete
            </button>
            {addOpen && (
              <div className="gl-card absolute right-0 top-11 z-20 w-72 p-3">
                <div className="relative mb-2">
                  <Icon
                    name="search"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-[var(--gl-on-surface-variant)]"
                  />
                  <input
                    autoFocus
                    value={addQuery}
                    onChange={(e) => setAddQuery(e.target.value)}
                    placeholder="Search users…"
                    className="gl-input w-full rounded-lg py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {addable.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-[var(--gl-on-surface-variant)]">No users</p>
                  ) : (
                    addable.slice(0, 20).map((u) => (
                      <button
                        key={u.id}
                        onClick={() => addUser(u)}
                        className="gl-row flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left"
                      >
                        <InitialsAvatar name={u.display_name} color={u.avatar_color} size={28} />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-[var(--gl-on-surface)]">{u.display_name}</p>
                          <p className="truncate text-xs text-[var(--gl-on-surface-variant)]">{u.email}</p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* AI model */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--gl-on-surface-variant)]">
              AI Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="gl-select rounded-lg px-3 py-2.5 text-sm"
            >
              {/* Keep the current value visible even if it left the catalog. */}
              {!models.some((m) => m.model_key === model) && <option value={model}>{model}</option>}
              {models
                .filter((m) => m.enabled)
                .map((m) => (
                  <option key={m.id} value={m.model_key}>
                    {m.display_name} {m.is_default ? "(default)" : ""}
                  </option>
                ))}
            </select>
          </div>

          {/* Assigned users */}
          <div>
            <p className="mb-2 text-sm font-medium text-[var(--gl-on-surface-variant)]">Assigned Users</p>
            {access === null ? (
              <Loading />
            ) : access.length === 0 ? (
              <Empty text="No users assigned yet." />
            ) : (
              <div className="space-y-2">
                {access.map((e) => (
                  <div
                    key={e.user_id}
                    className="flex items-center gap-3 rounded-lg border border-[rgba(125,211,252,0.06)] bg-[rgba(26,36,56,0.3)] p-3"
                  >
                    <InitialsAvatar name={e.display_name} color={null} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--gl-on-surface)]">
                        {e.display_name}
                        {e.is_creator && (
                          <span className="ml-2 rounded bg-[rgba(125,211,252,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--gl-primary)]">
                            Creator
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-[var(--gl-on-surface-variant)]">{e.email}</p>
                    </div>
                    <select
                      value={e.role_name ?? ""}
                      onChange={(ev) => changeRole(e.user_id, ev.target.value as BackendRole)}
                      className="gl-select w-32 rounded-lg px-2 py-1.5 text-xs"
                    >
                      {!e.role_name && <option value="">— none —</option>}
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => remove(e)}
                      disabled={!e.role_name}
                      title={e.role_name ? "Remove access" : "No explicit assignment to remove"}
                      className="gl-btn gl-btn-ghost h-8 w-8 rounded-lg p-0 disabled:opacity-30"
                    >
                      <Icon name="delete" className="text-[18px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-[rgba(125,211,252,0.1)] p-6">
          <div className="relative">
            <FolderDropdown
              folders={folders}
              primaryFolder={primaryFolder}
              checkedCount={checkedFolders.length}
              onToggle={toggleFolder}
            />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="gl-btn gl-btn-ghost px-4 py-2 text-sm">
              Cancel
            </button>
            <button onClick={save} disabled={saving} className="gl-btn gl-btn-solid px-5 py-2 text-sm font-semibold">
              {saving ? <Icon name="progress_activity" className="gl-spin text-base" /> : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Requirement 6: pick the folders a document appears in. The primary folder is
// always implied (shown checked + locked); the rest are extra placements.
function FolderDropdown({
  folders,
  primaryFolder,
  checkedCount,
  onToggle,
}: {
  folders: FolderCheckItem[] | null;
  primaryFolder: string | null;
  checkedCount: number;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <span className="mr-2 text-sm font-medium text-[var(--gl-on-surface-variant)]">Folder(s)</span>
      <button onClick={() => setOpen((v) => !v)} className="gl-btn gl-btn-ghost px-3 py-2 text-sm">
        {checkedCount > 0 ? `${checkedCount} selected` : "Choose"}
        <Icon name="expand_more" className="text-base" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="gl-card absolute bottom-11 left-0 z-20 max-h-64 w-64 overflow-y-auto p-2">
            {!folders || folders.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-[var(--gl-on-surface-variant)]">No folders</p>
            ) : (
              folders.map((f) => {
                const isPrimary = f.folder_id === primaryFolder;
                return (
                  <label
                    key={f.folder_id}
                    className={`gl-row flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 ${
                      isPrimary ? "opacity-70" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={f.checked}
                      disabled={isPrimary}
                      onChange={() => onToggle(f.folder_id)}
                      className="size-4 rounded border-[rgba(125,211,252,0.3)] bg-transparent text-[var(--gl-primary)]"
                    />
                    <Icon name="folder" fill className="text-base text-[var(--gl-secondary)]" />
                    <span className="flex-1 truncate text-sm text-[var(--gl-on-surface)]">{f.name}</span>
                    {isPrimary && <span className="text-[10px] text-[var(--gl-on-surface-variant)]">primary</span>}
                  </label>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-6">
      <Icon name="progress_activity" className="gl-spin text-xl text-[var(--gl-primary)]" />
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-[rgba(125,211,252,0.1)] px-3 py-6 text-center text-xs text-[var(--gl-on-surface-variant)]">{text}</p>;
}

export { roleLabel };
