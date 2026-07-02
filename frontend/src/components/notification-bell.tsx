"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import * as notificationsApi from "@/lib/api/notifications";
import * as documentsApi from "@/lib/api/documents";

type Notif = notificationsApi.Notification;

function messageFor(n: Notif): string {
  const versionNo = String(n.payload.version_no ?? "?");
  switch (n.type) {
    case "submission_pending":
      return `Version ${versionNo} was submitted for your review`;
    case "version_approved":
      return `Version ${versionNo} was approved — the comparison baseline updated`;
    case "version_rejected":
      return `Version ${versionNo} was rejected`;
    case "recommendation_created":
      return `A manager left feedback on version ${versionNo}`;
    default:
      return n.type;
  }
}

function iconFor(type: string): string {
  switch (type) {
    case "submission_pending":
      return "rate_review";
    case "version_approved":
      return "check_circle";
    case "version_rejected":
      return "cancel";
    case "recommendation_created":
      return "forum";
    default:
      return "notifications";
  }
}

/** Where clicking a notification should take the user (see editor-top-bar.tsx
 *  for how ?open= is consumed to deep-link into the right panel/dialog). */
function targetUrl(n: Notif): string {
  const versionId = n.payload.version_id as string | undefined;
  switch (n.type) {
    case "version_approved":
      return versionId
        ? `/editor?doc=${n.document_id}&open=compare&compareVersion=${versionId}`
        : `/editor?doc=${n.document_id}&open=versions`;
    case "recommendation_created":
      return `/editor?doc=${n.document_id}&open=recommendations`;
    default:
      return `/editor?doc=${n.document_id}&open=versions`;
  }
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

const MAX_SHOWN = 20;

/**
 * Notification bell: click to open a dropdown of recent notifications
 * (submissions pending review, approvals/rejections, reviewer feedback).
 * Each entry deep-links into the relevant document/panel and marks itself
 * read on click. Used in both the browser top nav and the editor top bar, so
 * a notification is reachable no matter where the user currently is.
 */
export function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = React.useState<Notif[] | null>(null);
  const [titles, setTitles] = React.useState<Record<string, string>>({});

  // Re-fetches everything on each call (list is capped at MAX_SHOWN and only
  // called on mount / popover-open, not on a tight loop, so re-resolving a
  // handful of doc titles every time is cheap and avoids a stale-closure ref).
  const load = React.useCallback(async () => {
    try {
      const list = await notificationsApi.listNotifications(false);
      const capped = list.slice(0, MAX_SHOWN);
      setItems(capped);
      const ids = [...new Set(capped.map((n) => n.document_id))];
      const docs = await Promise.all(
        ids.map((id) => documentsApi.getDocument(id).catch(() => null)),
      );
      setTitles(Object.fromEntries(ids.map((id, i) => [id, docs[i]?.title ?? "Untitled document"])));
    } catch {
      /* backend unreachable — leave whatever was last loaded */
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, guarded internally by load()'s own try/catch
    void load();
  }, [load]);

  const unreadCount = items?.filter((n) => !n.read_at).length ?? 0;

  const openNotification = (n: Notif) => {
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)) ?? prev);
      void notificationsApi.markRead(n.id).catch(() => {});
    }
    router.push(targetUrl(n));
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      const now = new Date().toISOString();
      setItems((prev) => prev?.map((x) => ({ ...x, read_at: x.read_at ?? now })) ?? prev);
    } catch {
      toast.error("Couldn't mark all as read");
    }
  };

  return (
    <Popover onOpenChange={(v) => v && void load()}>
      <PopoverTrigger
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
        className="relative flex size-8 items-center justify-center rounded-full text-on-surface-variant outline-none transition-colors hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-primary-container"
      >
        <Icon name="notifications" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 size-2 rounded-full bg-status-error ring-2 ring-surface" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <p className="font-ui-sm text-ui-sm font-semibold text-text-primary">Notifications</p>
          {unreadCount > 0 && (
            <button
              onClick={() => void markAllRead()}
              className="font-ui-xs text-ui-xs font-medium text-primary-container hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto border-t border-border-subtle">
          {items === null ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-surface-container" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center font-ui-sm text-ui-sm text-text-muted">
              You&apos;re all caught up.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-container-low",
                  !n.read_at && "bg-accent-bg/40",
                )}
              >
                <Icon
                  name={iconFor(n.type)}
                  size={18}
                  className="mt-0.5 shrink-0 text-primary-container"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-ui-xs text-ui-xs font-medium text-text-muted">
                    {titles[n.document_id] ?? "Document"}
                  </p>
                  <p className="font-ui-sm text-ui-sm text-text-primary">{messageFor(n)}</p>
                  <p className="font-ui-xs text-ui-xs text-text-muted">{ago(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary-container" />
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
