"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

export type InviteRow = {
  inviteToken?: string;
  candidateName?: string;
  candidateEmail?: string;
  status?: string;
  candidateReportToken?: string;
};

export type ResultRow = {
  inviteToken?: string;
  passedCount?: number;
  totalCriteria?: number;
  correctness?: number;
};

// Local (client-safe) correctness helper -- deliberately NOT imported from the
// server report-bits module so this "use client" component pulls no server code
// into the browser bundle. Same formula as report-bits.correctnessPct.
function pctOf(passed?: number, total?: number): number {
  if (!total || total <= 0) return 0;
  return Math.round(((passed ?? 0) / total) * 100);
}

// Maps engine invite lifecycle status -> employer-facing label + style.
function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "unknown").toLowerCase();
  const style: Record<string, string> = {
    created: "bg-line text-ink-soft",
    consented: "bg-line text-ink-soft",
    verified: "bg-amber-100 text-amber-800",
    booked: "bg-amber-100 text-amber-800",
    started: "bg-brand/10 text-brand-strong",
    submitted: "bg-emerald-100 text-emerald-800",
    revoked: "bg-line text-muted",
    expired: "bg-line text-muted",
  };
  const label: Record<string, string> = {
    created: "Invited",
    consented: "Consented",
    verified: "Verified",
    booked: "Booked",
    started: "In progress",
    submitted: "Completed",
    revoked: "Revoked",
    expired: "Expired",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        style[s] ?? "bg-line text-ink-soft"
      }`}
    >
      {label[s] ?? status ?? "Unknown"}
    </span>
  );
}

export default function InvitesTable({
  assessmentId,
  invites,
  results,
}: {
  assessmentId: string;
  invites: InviteRow[];
  results?: Record<string, ResultRow>;
}) {
  const router = useRouter();
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  // Client-only: build absolute links from window.location so copy/open give a
  // URL that works from any device, not just relative.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function handleRevoke(inviteToken?: string) {
    if (!inviteToken) return;
    setError(null);
    setRevokingToken(inviteToken);
    try {
      const res = await fetch("/api/portal/invites/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken, assessmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not revoke invite.");
        setRevokingToken(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setRevokingToken(null);
    }
  }

  if (invites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-soft">
        No candidates added yet.
      </div>
    );
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Candidate</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite, i) => {
                const revoked = (invite.status ?? "").toLowerCase() === "revoked";
                const link = invite.inviteToken ? `${origin}/a/${invite.inviteToken}` : "";
                const result = invite.inviteToken ? results?.[invite.inviteToken] : undefined;
                const hasResult = Boolean(result && (result.totalCriteria ?? 0) > 0);
                const pct = hasResult ? pctOf(result!.passedCount, result!.totalCriteria) : 0;
                const reportUrl =
                  hasResult && invite.candidateReportToken
                    ? `${origin}/r/c/${invite.candidateReportToken}`
                    : "";
                return (
                  <tr key={invite.inviteToken ?? i} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{invite.candidateName ?? "—"}</div>
                      {invite.candidateEmail ? (
                        <div className="text-xs text-muted">{invite.candidateEmail}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invite.status} />
                    </td>
                    <td className="px-4 py-3">
                      {hasResult ? (
                        <div className="flex items-center gap-2.5">
                          <span className="tabular-nums text-ink-soft">
                            {result!.passedCount ?? 0}/{result!.totalCriteria}
                          </span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-canvas">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-brand to-[#f59e0b]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-9 tabular-nums font-semibold text-ink">{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {reportUrl ? (
                          <a
                            href={reportUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-brand-strong hover:underline"
                          >
                            View report
                          </a>
                        ) : null}
                        {link ? <CopyButton value={link} label="Copy link" /> : null}
                        {!revoked && invite.inviteToken ? (
                          <button
                            type="button"
                            onClick={() => handleRevoke(invite.inviteToken)}
                            disabled={revokingToken === invite.inviteToken}
                            className="text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {revokingToken === invite.inviteToken ? "Revoking…" : "Revoke"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
