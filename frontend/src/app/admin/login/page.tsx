"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { ApiError } from "@/lib/api/client";
import { adminLogin } from "@/lib/api/admin";

// Requirement 7: the admin gets a completely separate login page + UI. Hits
// POST /api/admin/login, which rejects non-admins (403) even with valid
// credentials — so a normal user can't slip into the admin panel here.
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError("Enter your admin email.");
    if (!password) return setError("Enter your password.");

    setLoading(true);
    try {
      const admin = await adminLogin(email, password);
      toast.success(`Welcome, ${admin.display_name.split(" ")[0]}`);
      router.push("/admin");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.status === 403
            ? "Administrator privileges required."
            : err.status === 401
              ? "Incorrect email or password."
              : err.message
          : "Couldn't authenticate.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative z-10 flex min-h-screen w-full items-center justify-center px-6">
      <div className="gl-ambient gl-ambient-1" />
      <div className="gl-ambient gl-ambient-2" />

      <div className="gl-panel relative z-10 flex w-full max-w-[440px] flex-col items-center rounded-2xl p-8 sm:p-10">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(125,211,252,0.2)] bg-[rgba(125,211,252,0.1)] shadow-[0_0_20px_rgba(125,211,252,0.1)]">
            <Icon name="admin_panel_settings" fill className="text-[30px] text-[var(--gl-primary)]" />
          </div>
          <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[var(--gl-on-surface)]">Docolab</h1>
          <p className="text-sm text-[var(--gl-on-surface-variant)]">System Controller Access</p>
        </div>

        {error && (
          <div className="mb-5 flex w-full items-center gap-2 rounded-lg border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-sm text-[var(--gl-error)]">
            <Icon name="error" size={18} />
            {error}
          </div>
        )}

        <form className="w-full space-y-6" onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            <div className="group relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--gl-on-surface-variant)] transition-colors group-focus-within:text-[var(--gl-primary)]">
                <Icon name="person" className="text-xl" />
              </div>
              <input
                className="gl-input block w-full rounded-lg py-3.5 pl-12 pr-4 text-sm"
                type="email"
                autoComplete="email"
                placeholder="Admin Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="group relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--gl-on-surface-variant)] transition-colors group-focus-within:text-[var(--gl-primary)]">
                <Icon name="lock" className="text-xl" />
              </div>
              <input
                className="gl-input block w-full rounded-lg py-3.5 pl-12 pr-4 text-sm"
                type="password"
                autoComplete="current-password"
                placeholder="Secure Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="gl-btn gl-btn-solid w-full gap-2 py-3.5 text-sm font-semibold tracking-wide disabled:opacity-70"
          >
            {loading ? (
              <>
                <Icon name="progress_activity" className="gl-spin text-base" /> Authenticating…
              </>
            ) : (
              <>
                Authenticate
                <Icon name="login" fill className="text-sm" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex w-full items-center justify-center gap-2 border-t border-[rgba(125,211,252,0.06)] pt-6 text-xs text-[rgba(160,180,196,0.5)]">
          <Icon name="shield" className="text-[14px]" />
          <p>End-to-end encrypted connection</p>
        </div>
      </div>
    </main>
  );
}
