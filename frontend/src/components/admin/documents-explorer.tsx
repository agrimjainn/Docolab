"use client";

import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { ApiError } from "@/lib/api/client";
import { createDocument, createFolder, type AdminDoc, type Folder } from "@/lib/api/admin";

function fileIcon(title: string): { icon: string; color: string } {
  const ext = title.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return { icon: "image", color: "text-[var(--gl-tertiary)]" };
  if (["xlsx", "xls", "csv"].includes(ext)) return { icon: "table_chart", color: "text-[#4ade80]" };
  if (["pdf"].includes(ext)) return { icon: "picture_as_pdf", color: "text-[#ff8a8a]" };
  return { icon: "description", color: "text-[rgba(125,211,252,0.7)]" };
}

// Requirements 1, 3, 8, 6: org-wide document explorer with search, folder
// filter, and admin document/folder creation. Clicking a document opens its
// management modal.
export function DocumentsExplorer({
  docs,
  folders,
  loading,
  search,
  selectedFolderId,
  onSelectFolder,
  onOpenDoc,
  onCreated,
}: {
  docs: AdminDoc[];
  folders: Folder[];
  loading: boolean;
  search: string;
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onOpenDoc: (d: AdminDoc) => void;
  onCreated: () => void;
}) {
  const [view, setView] = React.useState<"grid" | "list">("grid");

  const newDocument = async () => {
    const title = prompt("New document title:", "Untitled document");
    if (!title?.trim()) return;
    try {
      const doc = await createDocument(title.trim(), selectedFolderId);
      toast.success(`Created "${doc.title}"`);
      onCreated();
      onOpenDoc(doc);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create document");
    }
  };

  const newFolder = async () => {
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    try {
      await createFolder(name.trim());
      toast.success(`Folder "${name.trim()}" created`);
      onCreated();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create folder");
    }
  };

  const activeFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="gl-card flex flex-1 flex-col overflow-hidden">
      {/* Explorer header */}
      <div className="gl-card-header flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => onSelectFolder(null)}
            className="flex items-center gap-1 text-[var(--gl-on-surface-variant)] transition-colors hover:text-[var(--gl-primary)]"
          >
            <Icon name="home" className="text-lg" />
          </button>
          <span className="text-[rgba(160,180,196,0.5)]">/</span>
          <span className={activeFolder ? "text-[var(--gl-on-surface-variant)]" : "font-medium text-[var(--gl-primary)]"}>
            {activeFolder ? activeFolder.name : "All documents"}
          </span>
          {search && (
            <>
              <span className="text-[rgba(160,180,196,0.5)]">/</span>
              <span className="text-[var(--gl-on-surface-variant)]">“{search}”</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={newDocument} className="gl-btn px-3 py-1.5 text-xs font-medium">
            <Icon name="note_add" className="text-[18px]" /> New Document
          </button>
          <button onClick={newFolder} className="gl-btn px-3 py-1.5 text-xs font-medium">
            <Icon name="create_new_folder" className="text-[18px]" /> New Folder
          </button>
          <div className="mx-1 h-5 w-px bg-[rgba(125,211,252,0.1)]" />
          <button
            onClick={() => setView("list")}
            className={`rounded-md border p-1.5 transition-colors ${
              view === "list"
                ? "border-[rgba(125,211,252,0.2)] bg-[rgba(125,211,252,0.1)] text-[var(--gl-primary)]"
                : "border-transparent text-[var(--gl-on-surface-variant)] hover:text-[var(--gl-primary)]"
            }`}
            aria-label="List view"
          >
            <Icon name="view_list" className="text-xl" />
          </button>
          <button
            onClick={() => setView("grid")}
            className={`rounded-md border p-1.5 transition-colors ${
              view === "grid"
                ? "border-[rgba(125,211,252,0.2)] bg-[rgba(125,211,252,0.1)] text-[var(--gl-primary)]"
                : "border-transparent text-[var(--gl-on-surface-variant)] hover:text-[var(--gl-primary)]"
            }`}
            aria-label="Grid view"
          >
            <Icon name="grid_view" className="text-xl" />
          </button>
        </div>
      </div>

      {/* Folder chips */}
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-[rgba(125,211,252,0.08)] px-6 py-3">
          <FolderChip active={selectedFolderId === null} onClick={() => onSelectFolder(null)} label="All" icon="apps" />
          {folders.map((f) => (
            <FolderChip
              key={f.id}
              active={selectedFolderId === f.id}
              onClick={() => onSelectFolder(f.id)}
              label={f.name}
              icon="folder"
            />
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Icon name="progress_activity" className="gl-spin text-2xl text-[var(--gl-primary)]" />
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Icon name="folder_open" className="text-5xl text-[rgba(125,211,252,0.3)]" />
            <p className="text-sm text-[var(--gl-on-surface-variant)]">
              {search ? "No documents match your search." : "No documents here yet."}
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 content-start gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {docs.map((d) => {
              const { icon, color } = fileIcon(d.title);
              return (
                <button
                  key={d.id}
                  onClick={() => onOpenDoc(d)}
                  className="group/card relative flex flex-col items-center justify-center gap-3 rounded-xl border border-[rgba(125,211,252,0.05)] bg-[rgba(20,28,46,0.2)] p-6 text-center transition-all hover:border-[rgba(125,211,252,0.2)] hover:bg-[rgba(26,36,56,0.3)]"
                >
                  <Icon name={icon} className={`text-5xl ${color}`} />
                  <div className="w-full">
                    <p className="truncate text-sm font-medium text-[var(--gl-on-surface)] group-hover/card:text-[var(--gl-primary)]">
                      {d.title}
                    </p>
                    <p className="mt-1 truncate text-xs text-[var(--gl-on-surface-variant)]">
                      {d.creator_name ?? "—"} · {new Date(d.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  {d.trashed && (
                    <span className="absolute left-3 top-3 rounded bg-[rgba(255,107,107,0.12)] px-1.5 py-0.5 text-[10px] text-[var(--gl-error)]">
                      trashed
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[rgba(125,211,252,0.06)]">
            {docs.map((d, i) => {
              const { icon, color } = fileIcon(d.title);
              return (
                <button
                  key={d.id}
                  onClick={() => onOpenDoc(d)}
                  className={`gl-row flex w-full items-center gap-3 px-4 py-3 text-left ${
                    i > 0 ? "border-t border-[rgba(125,211,252,0.05)]" : ""
                  }`}
                >
                  <Icon name={icon} className={`text-xl ${color}`} />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--gl-on-surface)]">{d.title}</span>
                  <span className="hidden shrink-0 text-xs text-[var(--gl-on-surface-variant)] sm:block">
                    {d.creator_name ?? "—"}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--gl-on-surface-variant)]">
                    {new Date(d.updated_at).toLocaleDateString()}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FolderChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[rgba(125,211,252,0.3)] bg-[rgba(125,211,252,0.15)] text-[var(--gl-primary)]"
          : "border-[rgba(125,211,252,0.08)] text-[var(--gl-on-surface-variant)] hover:border-[rgba(125,211,252,0.2)] hover:text-[var(--gl-on-surface)]"
      }`}
    >
      <Icon name={icon} className="text-sm" />
      {label}
    </button>
  );
}
