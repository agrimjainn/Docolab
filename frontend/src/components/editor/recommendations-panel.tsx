"use client";

import * as React from "react";
import { toast } from "sonner";

import { Icon } from "@/components/icon";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useDocument } from "@/lib/store/document-store";
import { getSnapshots } from "@/lib/api/snapshots";
import * as assignments from "@/lib/api/assignments";
import * as auth from "@/lib/api/auth";
import {
  listRecommendations,
  listResponses,
  createResponse,
  updateRecommendationStatus,
  type Recommendation,
  type RecommendationResponse,
} from "@/lib/api/recommendations";

interface Row {
  rec: Recommendation;
  versionNo: number;
}

const STATUS_TONE: Record<Recommendation["status"], string> = {
  open: "bg-status-warning/15 text-status-warning",
  addressed: "bg-insertion-bg text-insertion-text",
  orphaned: "bg-surface-container text-text-muted",
};

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

/**
 * Dedicated panel listing every Manager recommendation (approval/rejection
 * feedback) across the document's version history, each with its reply
 * thread. Loads independently of the comments/discussion plugin — feedback is
 * a separate backend concept (recommendations, not comments).
 */
export function RecommendationsPanel() {
  const { docId, setRecommendationsOpen, caps } = useDocument();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const versions = await getSnapshots(docId);
      const perVersion = await Promise.all(
        versions.map((v) => listRecommendations(v.id).catch(() => [] as Recommendation[])),
      );
      const flat: Row[] = versions.flatMap((v, i) =>
        perVersion[i].map((rec) => ({ rec, versionNo: v.versionNo })),
      );
      flat.sort((a, b) => new Date(b.rec.created_at).getTime() - new Date(a.rec.created_at).getTime());
      setRows(flat);
    } catch {
      setRows([]);
    }
    try {
      const roster = await assignments.listOrgUsers();
      const map: Record<string, string> = {};
      for (const u of roster) map[u.id] = u.display_name;
      const me = auth.getCurrentUser();
      if (me) map[me.id] = me.name;
      setNames(map);
    } catch {
      /* names stay blank — falls back to "Unknown" below */
    }
  }, [docId]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount, guarded internally by load()'s own try/catch
    void load();
  }, [load]);

  const markAddressed = async (rec: Recommendation) => {
    try {
      await updateRecommendationStatus(rec.id, "addressed");
      toast.success("Marked addressed");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update status");
    }
  };

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border-subtle bg-panel-surface">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="font-ui-base text-ui-base font-semibold text-text-primary">
          Reviewer feedback
        </h2>
        <button
          onClick={() => setRecommendationsOpen(false)}
          aria-label="Close feedback"
          className="flex size-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container"
        >
          <Icon name="close" size={18} />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-4">
        {rows === null ? (
          <div className="space-y-2 p-1">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded bg-surface-container" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-text-muted">
            <Icon name="rate_review" size={32} />
            <p className="font-ui-sm text-ui-sm">
              No reviewer feedback yet. Notes left on approve/reject decisions show up here.
            </p>
          </div>
        ) : (
          rows.map(({ rec, versionNo }) => (
            <FeedbackCard
              key={rec.id}
              rec={rec}
              versionNo={versionNo}
              authorName={names[rec.author_id] ?? "Unknown"}
              expanded={expanded === rec.id}
              onToggleExpand={() => setExpanded((v) => (v === rec.id ? null : rec.id))}
              canMarkAddressed={caps.canApprove && rec.status === "open"}
              canReply={caps.canComment}
              onMarkAddressed={() => void markAddressed(rec)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function FeedbackCard({
  rec,
  versionNo,
  authorName,
  expanded,
  onToggleExpand,
  canMarkAddressed,
  canReply,
  onMarkAddressed,
}: {
  rec: Recommendation;
  versionNo: number;
  authorName: string;
  expanded: boolean;
  onToggleExpand: () => void;
  canMarkAddressed: boolean;
  canReply: boolean;
  onMarkAddressed: () => void;
}) {
  const [responses, setResponses] = React.useState<RecommendationResponse[] | null>(null);
  const [draft, setDraft] = React.useState("");
  const [names, setNames] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    void listResponses(rec.id).then((r) => {
      if (!cancelled) setResponses(r);
    });
    void assignments.listOrgUsers().then((roster) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const u of roster) map[u.id] = u.display_name;
      const me = auth.getCurrentUser();
      if (me) map[me.id] = me.name;
      setNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, rec.id]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      const created = await createResponse(rec.id, text);
      setResponses((prev) => [...(prev ?? []), created]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send reply");
    }
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-bright p-3 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="rounded-full bg-surface-container-low px-2 py-0.5 font-ui-xs text-ui-xs font-medium text-text-secondary">
          Version {versionNo}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 font-ui-xs text-ui-xs font-semibold", STATUS_TONE[rec.status])}>
          {rec.status}
        </span>
      </div>
      <div className="flex gap-2.5">
        <Avatar size="sm" className="mt-0.5">
          <AvatarFallback>{initials(authorName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-ui-sm text-ui-sm font-semibold text-text-primary">
              {authorName}
            </span>
            <span className="font-ui-xs text-ui-xs text-text-muted">{ago(rec.created_at)}</span>
          </div>
          <p className="font-ui-sm text-ui-sm whitespace-pre-wrap break-words text-text-secondary">
            {rec.body}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-border-subtle pt-2">
        <button
          onClick={onToggleExpand}
          className="flex items-center gap-1 rounded-md px-2 py-1 font-ui-xs text-ui-xs font-semibold text-text-secondary transition-colors hover:bg-surface-container"
        >
          <Icon name={expanded ? "expand_less" : "chat_bubble"} size={14} />
          {expanded ? "Hide replies" : "Reply"}
        </button>
        {canMarkAddressed && (
          <button
            onClick={onMarkAddressed}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 font-ui-xs text-ui-xs font-semibold text-insertion-text transition-colors hover:bg-insertion-bg"
          >
            <Icon name="check_circle" size={14} />
            Mark addressed
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-border-subtle pt-2">
          {responses === null ? (
            <div className="h-6 animate-pulse rounded bg-surface-container" />
          ) : (
            responses.map((r) => (
              <div key={r.id} className="pl-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-ui-xs text-ui-xs font-semibold text-text-primary">
                    {names[r.author_id] ?? "Unknown"}
                  </span>
                  <span className="font-ui-xs text-ui-xs text-text-muted">{ago(r.created_at)}</span>
                </div>
                <p className="font-ui-xs text-ui-xs whitespace-pre-wrap break-words text-text-secondary">
                  {r.body}
                </p>
              </div>
            ))
          )}
          {canReply && (
            <div className="flex items-center gap-2 pt-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void send()}
                placeholder="Reply…"
                className="flex-1 bg-transparent font-ui-xs text-ui-xs text-text-primary outline-none placeholder:text-text-muted"
              />
              {draft.trim() && (
                <button
                  onClick={() => void send()}
                  aria-label="Send reply"
                  className="flex size-6 items-center justify-center rounded-full bg-primary-container text-on-primary hover:bg-accent-hover"
                >
                  <Icon name="arrow_upward" size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
