"use client";

import { useState } from "react";

export type Lead = {
  leadId?: string;
  name?: string;
  email?: string;
  company?: string;
  topic?: string;
  message?: string;
  source?: string;
  status?: string;
  createdAt?: string;
  statusUpdatedAt?: string;
};

const TOPIC_LABEL: Record<string, string> = {
  walkthrough: "Walkthrough",
  pricing: "Pricing",
  other: "Other",
};

// Same badge palette as the portal invites table (amber = mid-pipeline,
// emerald = done-well, line/muted = terminal) so staff read one color language.
const STATUS_BADGE: Record<string, string> = {
  new: "bg-brand/10 text-brand-strong",
  contacted: "bg-amber-100 text-amber-800",
  closed: "bg-line text-ink-soft",
};

function formatWhen(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeadsTable({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(leadId: string, status: string) {
    setError(null);
    setPendingId(leadId);
    try {
      const res = await fetch("/api/admin/leads/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Could not update the lead.");
        return;
      }
      setLeads((prev) => prev.map((l) => (l.leadId === leadId ? { ...l, status } : l)));
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  if (leads.length === 0) {
    return (
      <p className="mt-8 rounded-lg border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        No leads yet. They&apos;ll appear here as soon as someone submits the
        &ldquo;Book a walkthrough&rdquo; form.
      </p>
    );
  }

  return (
    <div className="mt-8">
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-4">
        {leads.map((lead) => {
          const status = lead.status ?? "new";
          const busy = pendingId === lead.leadId;
          return (
            <li key={lead.leadId} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {lead.name || "—"}
                    {lead.company ? <span className="font-normal text-ink-soft"> · {lead.company}</span> : null}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    <a href={`mailto:${lead.email}`} className="hover:text-brand-strong hover:underline">
                      {lead.email}
                    </a>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {TOPIC_LABEL[lead.topic ?? ""] ?? "Other"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide ${
                      STATUS_BADGE[status] ?? STATUS_BADGE.new
                    }`}
                  >
                    {status}
                  </span>
                </div>
              </div>

              {lead.message ? (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-sm leading-relaxed text-ink-soft">
                  {lead.message}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {formatWhen(lead.createdAt)}
                  {lead.source ? ` · from ${lead.source}` : ""}
                </p>
                <div className="flex items-center gap-2">
                  {status !== "contacted" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(lead.leadId!, "contacted")}
                      className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Mark contacted
                    </button>
                  )}
                  {status !== "closed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(lead.leadId!, "closed")}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Close
                    </button>
                  )}
                  {status === "closed" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(lead.leadId!, "new")}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-line-strong hover:text-ink-soft disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
