"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { getToken } from "@/lib/api/client";

/**
 * Client-side route guard for authenticated pages. The access token lives in
 * localStorage (read only in the browser), so this cannot be a server
 * middleware — it checks for a token on mount and bounces to /login if absent.
 * Mutating API calls are still re-validated server-side (401 → /login), so this
 * is a UX guard, not the security boundary.
 */
// Token presence as an external store: server snapshot is always false (no
// localStorage), client snapshot reflects the real token. useSyncExternalStore
// reconciles the two without a hydration mismatch or setState-in-effect.
function useHasToken(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => !!getToken(),
    () => false,
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const hasToken = useHasToken();

  // Only redirect once the component has mounted on the client. On the very
  // first post-hydration render, useSyncExternalStore returns the SERVER
  // snapshot (false) to match the SSR HTML before switching to the real client
  // snapshot. Redirecting in that window bounced authenticated users to /login
  // on every hard load / refresh. Gating on `mounted` defers the decision by
  // one render, by which point the token snapshot reflects localStorage.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (mounted && !hasToken) router.replace("/login");
  }, [mounted, hasToken, router]);

  if (!hasToken) return null;
  return <>{children}</>;
}
