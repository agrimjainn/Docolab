"use client";

import * as React from "react";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/client";
import { AdminGuard } from "@/components/admin/admin-guard";
import { AdminTopNav } from "@/components/admin/admin-top-nav";
import { UsersPanel } from "@/components/admin/users-panel";
import { AnalyticsCards } from "@/components/admin/analytics-cards";
import { DocumentsExplorer } from "@/components/admin/documents-explorer";
import { DocumentModal } from "@/components/admin/document-modal";
import { UserModal } from "@/components/admin/user-modal";
import { listUsers, listDocuments, listFolders, type AdminUser, type AdminDoc, type Folder } from "@/lib/api/admin";

function AdminDashboard() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selectedFolderId, setSelectedFolderId] = React.useState<string | null>(null);

  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [docs, setDocs] = React.useState<AdminDoc[]>([]);
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(true);
  const [docsLoading, setDocsLoading] = React.useState(true);

  const [openDoc, setOpenDoc] = React.useState<AdminDoc | null>(null);
  const [openUser, setOpenUser] = React.useState<AdminUser | null>(null);

  // Debounce the search box so we don't hit /admin/documents on every keystroke.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const refreshUsers = React.useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const refreshFolders = React.useCallback(async () => {
    try {
      setFolders(await listFolders());
    } catch {
      /* folders are optional chrome */
    }
  }, []);

  const refreshDocs = React.useCallback(async () => {
    setDocsLoading(true);
    try {
      setDocs(await listDocuments({ q: debouncedSearch || undefined, folderId: selectedFolderId ?? undefined }));
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message);
    } finally {
      setDocsLoading(false);
    }
  }, [debouncedSearch, selectedFolderId]);

  React.useEffect(() => {
    refreshUsers();
    refreshFolders();
  }, [refreshUsers, refreshFolders]);

  React.useEffect(() => {
    refreshDocs();
  }, [refreshDocs]);

  // Poll presence every 30s so the online dots stay fresh.
  React.useEffect(() => {
    const id = setInterval(refreshUsers, 30_000);
    return () => clearInterval(id);
  }, [refreshUsers]);

  return (
    <>
      <div className="gl-ambient gl-ambient-1" />
      <div className="gl-ambient gl-ambient-2" />

      <AdminTopNav search={search} onSearch={setSearch} />

      {/* Root <body> is h-screen + overflow-hidden (editor app), so the dashboard
          must own its own scroll or content past the fold gets clipped. */}
      <main className="relative z-10 h-screen w-full overflow-y-auto pt-16">
        <div className="px-8 py-6 pb-2">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-[var(--gl-on-surface)]">
            <span className="h-6 w-1.5 rounded-full bg-[var(--gl-primary)] shadow-[0_0_10px_rgba(125,211,252,0.6)]" />
            System Overview
          </h1>
        </div>

        <div className="p-8 pt-4">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-10">
            {/* Left: users + analytics (30%) */}
            <div className="flex flex-col gap-4 lg:col-span-3">
              <UsersPanel
                users={users}
                loading={usersLoading}
                search={search}
                onSelectUser={setOpenUser}
                onUserCreated={refreshUsers}
              />
              <AnalyticsCards />
            </div>

            {/* Right: documents (70%) */}
            <div className="flex flex-col gap-4 lg:col-span-7">
              <DocumentsExplorer
                docs={docs}
                folders={folders}
                loading={docsLoading}
                search={debouncedSearch}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onOpenDoc={setOpenDoc}
                onCreated={() => {
                  refreshDocs();
                  refreshFolders();
                }}
              />
            </div>
          </div>
        </div>
      </main>

      {openDoc && (
        <DocumentModal
          doc={openDoc}
          users={users}
          onClose={() => setOpenDoc(null)}
          onChanged={refreshDocs}
        />
      )}
      {openUser && (
        <UserModal
          user={openUser}
          allDocs={docs}
          onClose={() => setOpenUser(null)}
          onChanged={() => {
            refreshUsers();
            refreshDocs();
          }}
        />
      )}
    </>
  );
}

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminDashboard />
    </AdminGuard>
  );
}
