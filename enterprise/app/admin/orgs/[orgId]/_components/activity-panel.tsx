"use client";

import { useEffect, useState } from "react";

// Activity panel (W3B-1): the last ~30 durable audit events for one org, read
// from the admin-gated /api/admin/audit route (which fronts the engine's
// GET /ent/audit). Client-fetched on mount so the server org page stays fast and
// a slow/empty audit table never blocks the rest of the page. Read-only.

type AuditEvent = {
  auditId?: string;
  actor?: string;
  action?: string;
  target?: string;
  detail?: Record<string, unknown>;
  createdAt?: string;
};

// Map engine action slugs to short human labels; unknown slugs fall through to
// the raw slug so a newly-added action still renders (just less pretty).
const ACTION_LABELS: Record<string, string> = {
  "org.create": "Org created",
  "credits.adjust": "Credits adjusted",
  "org.delete": "Org deleted",
  "candidate.erase": "Candidate PII erased",
  "report.revoke": "Report revoked",
  "report.renew": "Report renewed",
  "order.create": "Order recorded",
  "order.paid": "Order marked paid",
  "agreement.create": "Agreement drafted",
  "agreement.update": "Agreement edited",
  "agreement.issue": "Agreement issued",
  "agreement.accept": "Agreement accepted",
  "agreement.void": "Agreement voided",
  "assessment.update": "Assessment updated",
};

function actionLabel(action?: string): string {
  if (!action) return "Activity";
  return ACTION_LABELS[action] ?? action;
}

function relativeTime(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function absoluteTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Render the small set of detail keys the engine attaches (credits, invoiceNo,
// reason, ...) as a compact "key: value" trail. Objects/arrays are JSON-stringified.
function detailSummary(detail?: Record<string, unknown>): string {
  if (!detail || typeof detail !== "object") return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined || value === "") continue;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${text}`);
    if (parts.length >= 4) break;
  }
  return parts.join("  |  ");
}

export default function ActivityPanel({ orgId }: { orgId: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/audit?orgId=${encodeURIComponent(orgId)}&limit=30`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? "Could not load the activity log.");
          return;
        }
        setEvents(Array.isArray(data?.audit) ? data.audit : []);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink-soft">Activity</h2>
      <p className="mt-1 text-xs text-muted">
        Durable audit trail for this org &mdash; most recent events first.
      </p>

      {error ? (
        <p className="mt-3 text-sm text-rose-700">{error}</p>
      ) : events === null ? (
        <p className="mt-4 text-sm text-muted">Loading activity&hellip;</p>
      ) : events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-center text-sm text-ink-soft">
          No recorded activity for this org yet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {events.map((e, i) => {
            const summary = detailSummary(e.detail);
            return (
              <li
                key={e.auditId ?? i}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-3 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-ink">{actionLabel(e.action)}</span>
                  {e.actor ? (
                    <span className="ml-2 text-xs text-muted">by {e.actor}</span>
                  ) : null}
                  {e.target ? (
                    <span className="ml-2 font-mono text-[11px] text-muted">
                      {e.target.slice(0, 12)}
                    </span>
                  ) : null}
                  {summary ? (
                    <div className="mt-0.5 truncate text-xs text-ink-soft">{summary}</div>
                  ) : null}
                </div>
                <time
                  className="shrink-0 text-xs text-muted"
                  dateTime={e.createdAt ?? undefined}
                  title={absoluteTime(e.createdAt)}
                >
                  {relativeTime(e.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
