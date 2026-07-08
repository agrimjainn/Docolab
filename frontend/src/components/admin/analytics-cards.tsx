"use client";

import * as React from "react";

import { Icon } from "@/components/icon";
import {
  usageByModel,
  usageByDocument,
  type UsageByModelResponse,
  type UsageByDocumentResponse,
} from "@/lib/api/admin";

const PALETTE = ["#7dd3fc", "#c8a0f0", "#88b4cc", "#4ade80", "#fbbf24", "#f472b6"];

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// The Admin "Model Usage" section — three stacked cards driven by the backend
// usage aggregations. Metering is tokens-only (no pricing yet), so the labels
// say "tokens" rather than "$".
export function AnalyticsCards() {
  const [byModel, setByModel] = React.useState<UsageByModelResponse | null>(null);
  const [byDoc, setByDoc] = React.useState<UsageByDocumentResponse | null>(null);
  const [err, setErr] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    Promise.all([usageByModel(), usageByDocument(5)])
      .then(([m, d]) => {
        if (!alive) return;
        setByModel(m);
        setByDoc(d);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <ModelDistribution data={byModel} err={err} />
      <TokenUsage data={byModel} err={err} />
      <TopDocuments data={byDoc} err={err} />
    </div>
  );
}

function Card({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="gl-card p-5">
      <h3 className="mb-4 flex items-center gap-2 font-medium text-[var(--gl-on-surface)]">
        <Icon name={icon} className="text-base text-[rgba(125,211,252,0.8)]" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Donut({ segments }: { segments: { pct: number; color: string }[] }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const top = segments[0]?.pct ?? 0;
  return (
    <div className="relative flex h-32 items-center justify-center">
      <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(125,211,252,0.12)" strokeWidth="10" />
        {segments.map((s, i) => {
          const len = (s.pct / 100) * c;
          const el = (
            <circle
              key={i}
              cx="56"
              cy="56"
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="10"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-sm font-bold text-[var(--gl-primary)]">{Math.round(top)}%</span>
      </div>
    </div>
  );
}

function ModelDistribution({ data, err }: { data: UsageByModelResponse | null; err: boolean }) {
  return (
    <Card icon="pie_chart" title="AI Model Distribution">
      {err ? (
        <NoData />
      ) : !data ? (
        <Skeleton h={128} />
      ) : data.models.length === 0 ? (
        <NoData text="No AI usage recorded yet." />
      ) : (
        <>
          <Donut segments={data.models.slice(0, PALETTE.length).map((m, i) => ({ pct: m.pct, color: PALETTE[i] }))} />
          <div className="mt-4 space-y-2">
            {data.models.slice(0, 5).map((m, i) => (
              <div key={m.model_key} className="flex justify-between text-xs">
                <span className="flex items-center gap-2 text-[var(--gl-on-surface-variant)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {m.display_name || m.model_key}
                </span>
                <span className="text-[var(--gl-primary)]">{m.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function TokenUsage({ data, err }: { data: UsageByModelResponse | null; err: boolean }) {
  return (
    <Card icon="payments" title="Token Usage">
      {err ? (
        <NoData />
      ) : !data ? (
        <Skeleton h={80} />
      ) : data.models.length === 0 ? (
        <NoData text="No usage yet." />
      ) : (
        <div className="space-y-3">
          {data.models.slice(0, 5).map((m) => (
            <div
              key={m.model_key}
              className="flex items-center justify-between rounded-lg border border-[rgba(125,211,252,0.05)] bg-[rgba(26,36,56,0.3)] p-2"
            >
              <span className="text-xs text-[var(--gl-on-surface)]">{m.display_name || m.model_key}</span>
              <span className="font-mono text-sm text-[var(--gl-primary)]">{fmt(m.total_tokens)}</span>
            </div>
          ))}
          <div className="flex justify-between px-1 pt-1 text-[11px] text-[var(--gl-on-surface-variant)]">
            <span>Total</span>
            <span className="font-mono">{fmt(data.total_tokens)} tokens</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function TopDocuments({ data, err }: { data: UsageByDocumentResponse | null; err: boolean }) {
  const max = data?.documents.reduce((m, d) => Math.max(m, d.total_tokens), 0) ?? 0;
  return (
    <Card icon="bar_chart" title="Top Documents by Usage">
      {err ? (
        <NoData />
      ) : !data ? (
        <Skeleton h={80} />
      ) : data.documents.length === 0 ? (
        <NoData text="No document usage yet." />
      ) : (
        <div className="space-y-3">
          {data.documents.map((d, i) => (
            <div key={d.document_id ?? `orphan-${i}`} className="space-y-1">
              <div className="flex justify-between text-[10px] text-[var(--gl-on-surface-variant)]">
                <span className="truncate">{d.title || "(deleted document)"}</span>
                <span className="font-mono">{fmt(d.total_tokens)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(26,36,56,0.4)]">
                <div
                  className="h-full rounded-full bg-[var(--gl-primary)] shadow-[0_0_8px_rgba(125,211,252,0.4)]"
                  style={{ width: `${max ? (d.total_tokens / max) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse rounded-lg bg-[rgba(26,36,56,0.4)]" style={{ height: h }} />;
}
function NoData({ text = "Usage data unavailable." }: { text?: string }) {
  return <p className="py-4 text-center text-xs text-[var(--gl-on-surface-variant)]">{text}</p>;
}
