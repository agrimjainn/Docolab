"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/icon";
import { getToken } from "@/lib/api/client";
import { adminMe, heartbeat, type AdminUser } from "@/lib/api/admin";

interface Ctx {
  admin: AdminUser;
}
const AdminContext = React.createContext<Ctx | null>(null);

/** Read the signed-in admin inside guarded pages. */
export function useAdmin(): AdminUser {
  const ctx = React.useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within <AdminGuard>");
  return ctx.admin;
}

// Client-side gate for the admin panel: confirms the session belongs to an org
// admin via GET /admin/me (403 for a normal user -> bounce to /admin/login) and
// starts the presence heartbeat so this admin shows as online to others.
export function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [admin, setAdmin] = React.useState<AdminUser | null>(null);
  const [status, setStatus] = React.useState<"checking" | "ok" | "denied">("checking");

  React.useEffect(() => {
    let alive = true;
    if (!getToken()) {
      router.replace("/admin/login");
      return;
    }
    adminMe()
      .then((me) => {
        if (!alive) return;
        setAdmin(me);
        setStatus("ok");
      })
      .catch(() => {
        if (!alive) return;
        setStatus("denied");
        router.replace("/admin/login");
      });
    return () => {
      alive = false;
    };
  }, [router]);

  // Presence heartbeat (~30s) while the panel is open.
  React.useEffect(() => {
    if (status !== "ok") return;
    heartbeat().catch(() => {});
    const id = setInterval(() => heartbeat().catch(() => {}), 30_000);
    return () => clearInterval(id);
  }, [status]);

  if (status !== "ok" || !admin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Icon name="progress_activity" className="gl-spin text-3xl text-[var(--gl-primary)]" />
      </div>
    );
  }

  return <AdminContext.Provider value={{ admin }}>{children}</AdminContext.Provider>;
}
