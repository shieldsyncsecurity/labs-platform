"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

export type InviteRow = {
  inviteToken?: string;
  candidateName?: string;
  candidateEmail?: string;
  status?: string;
  createdAt?: string;
  submittedAt?: string;
  candidateReportToken?: string;
  candidateReportRevokedAt?: string;
  candidateReportExpiresAt?: string;
};

export type ResultRow = {
  inviteToken?: string;
  passedCount?: number;
  totalCriteria?: number;
  correctness?: number;
};

// Kept ASCII in source (see repo rule); renders as a real em dash.
const EM_DASH = String.fromCharCode(8212);

const PROBLEM_MAX_CHARS = 2000;

// Invite statuses with no live magic-link to receive -- the engine refuses to
// re-email these, so the "Resend email" button is hidden for them. Mirrors the
// engine's NOT_RESENDABLE guard (submitted/revoked/refunded) plus expired.
const TERMINAL_STATUSES = new Set(["submitted", "revoked", "expired", "refunded"]);

// Local (client-safe) correctness helper -- deliberately NOT imported from the
// server report-bits module so this "use client" component pulls no server code
// into the browser bundle. Same formula as report-bits.correctnessPct.
function pctOf(passed?: number, total?: number): number {
  if (!total || total <= 0) return 0;
  return Math.round(((passed ?? 0) / total) * 100);
}

// Engine invite lifecycle status -> employer-facing label. Shared by the badge
// and the CSV export so the file says exactly what the screen says.
const STATUS_LABEL: Record<string, string> = {
  created: "Invited",
  consented: "Consented",
  verified: "Verified",
  booked: "Booked",
  started: "In progress",
  submitted: "Completed",
  revoked: "Revoked",
  expired: "Expired",
};

function statusLabel(status?: string): string {
  const s = (status ?? "").toLowerCase();
  return STATUS_LABEL[s] ?? status ?? "Unknown";
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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        style[s] ?? "bg-line text-ink-soft"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

// RFC-4180-ish cell escaping: quote anything containing a comma, quote, or
// newline; double embedded quotes. Cells starting with = + - @ (or tab/CR)
// get a leading apostrophe so Excel/Sheets never execute them as formulas.
function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
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
  // Per-row report-link lifecycle: "<token>:revoke" | "<token>:renew" while a
  // request is in flight.
  const [linkPending, setLinkPending] = useState<string | null>(null);
  // Inline "Report a problem" form: which row is open + its draft/pending
  // state. `problemSent` remembers rows already reported this page-load so the
  // button flips to a quiet confirmation instead of inviting duplicates.
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [problemText, setProblemText] = useState("");
  const [problemPending, setProblemPending] = useState(false);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [problemSent, setProblemSent] = useState<Record<string, boolean>>({});
  // Resend magic-link email (W3B-3): which row is in flight + the per-row
  // result notice (success or a cooldown/soft error message).
  const [resendingToken, setResendingToken] = useState<string | null>(null);
  const [resendMsg, setResendMsg] = useState<Record<string, { ok: boolean; text: string }>>({});

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

  // Revoke / renew a CANDIDATE report link (/r/c/<token>). The server route
  // re-verifies org ownership; on success we refresh so the row re-renders
  // from the engine's revokedAt/expiresAt truth.
  async function handleReportLink(action: "revoke" | "renew", inviteToken?: string) {
    if (!inviteToken) return;
    setError(null);
    setLinkPending(`${inviteToken}:${action}`);
    try {
      const res = await fetch(`/api/portal/report/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken, assessmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Could not ${action} the report link.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLinkPending(null);
    }
  }

  // Re-send the candidate's magic-link email. Never charges a credit; the
  // server route re-verifies org ownership. On a cooldown the engine returns a
  // whitelisted 429 -> we show a soft "wait" notice, not a hard error.
  async function handleResend(inviteToken?: string) {
    if (!inviteToken) return;
    setResendingToken(inviteToken);
    setResendMsg((prev) => {
      const next = { ...prev };
      delete next[inviteToken];
      return next;
    });
    try {
      const res = await fetch("/api/portal/invites/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken, assessmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResendMsg((prev) => ({
          ...prev,
          [inviteToken]: { ok: false, text: data?.error ?? "Could not resend the email." },
        }));
        return;
      }
      // emailed === false means SES did not accept it (cooldown already stamped
      // engine-side) -- report honestly rather than a flat "resent".
      const text = data?.emailed === false ? "Resent (delivery may be delayed)" : "Email resent";
      setResendMsg((prev) => ({ ...prev, [inviteToken]: { ok: true, text } }));
    } catch {
      setResendMsg((prev) => ({
        ...prev,
        [inviteToken]: { ok: false, text: "Could not reach the server. Try again." },
      }));
    } finally {
      setResendingToken(null);
    }
  }

  function openProblemForm(inviteToken?: string) {
    if (!inviteToken) return;
    setProblemFor((current) => (current === inviteToken ? null : inviteToken));
    setProblemText("");
    setProblemError(null);
  }

  async function handleProblemSubmit(inviteToken: string) {
    const message = problemText.trim();
    if (!message) {
      setProblemError("Describe the problem first.");
      return;
    }
    setProblemError(null);
    setProblemPending(true);
    try {
      const res = await fetch("/api/portal/problems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken, assessmentId, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblemError(data?.error ?? "Could not send the report.");
        return;
      }
      setProblemSent((prev) => ({ ...prev, [inviteToken]: true }));
      setProblemFor(null);
      setProblemText("");
    } catch {
      setProblemError("Could not reach the server. Try again.");
    } finally {
      setProblemPending(false);
    }
  }

  // Client-side CSV of what is already on this page -- no extra API call.
  // Columns match the table; report URL only rides on submitted rows whose
  // candidate report link is still live.
  function exportCsv() {
    const lines = [
      ["Candidate name", "Status", "Submitted at", "Correctness %", "Report URL"]
        .map(csvCell)
        .join(","),
    ];
    for (const invite of invites) {
      const result = invite.inviteToken ? results?.[invite.inviteToken] : undefined;
      const hasResult = Boolean(result && (result.totalCriteria ?? 0) > 0);
      const submitted = (invite.status ?? "").toLowerCase() === "submitted";
      const reportDead =
        Boolean(invite.candidateReportRevokedAt) ||
        (Boolean(invite.candidateReportExpiresAt) &&
          new Date(invite.candidateReportExpiresAt as string).getTime() < Date.now());
      const reportUrl =
        submitted && invite.candidateReportToken && !reportDead
          ? `${origin}/r/c/${invite.candidateReportToken}`
          : "";
      lines.push(
        [
          invite.candidateName ?? "",
          statusLabel(invite.status),
          invite.submittedAt ?? "",
          hasResult ? String(pctOf(result!.passedCount, result!.totalCriteria)) : "",
          reportUrl,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `candidates-${assessmentId.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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
      <div className="mb-3 flex items-center justify-between gap-3">
        {error ? <p className="text-sm text-rose-700">{error}</p> : <span />}
        <button
          type="button"
          onClick={exportCsv}
          className="shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand/40 hover:text-ink"
        >
          Export CSV
        </button>
      </div>
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
                const token = invite.inviteToken;
                const revoked = (invite.status ?? "").toLowerCase() === "revoked";
                const submitted = (invite.status ?? "").toLowerCase() === "submitted";
                const link = token ? `${origin}/a/${token}` : "";
                const result = token ? results?.[token] : undefined;
                const hasResult = Boolean(result && (result.totalCriteria ?? 0) > 0);
                const pct = hasResult ? pctOf(result!.passedCount, result!.totalCriteria) : 0;
                const reportDead =
                  Boolean(invite.candidateReportRevokedAt) ||
                  (Boolean(invite.candidateReportExpiresAt) &&
                    new Date(invite.candidateReportExpiresAt as string).getTime() < Date.now());
                const reportUrl =
                  submitted && invite.candidateReportToken && !reportDead
                    ? `${origin}/r/c/${invite.candidateReportToken}`
                    : "";
                const hasReportLink = submitted && Boolean(invite.candidateReportToken);
                // Resend is offered only for non-terminal invites that actually
                // have an email on file (copy-link-only invites have none).
                const resendable =
                  Boolean(token) &&
                  Boolean(invite.candidateEmail) &&
                  !TERMINAL_STATUSES.has((invite.status ?? "").toLowerCase());
                const resendNote = token ? resendMsg[token] : undefined;
                const problemOpen = Boolean(token) && problemFor === token;
                return (
                  <SingleRow key={token ?? i}>
                    <tr className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">
                          {invite.candidateName ?? EM_DASH}
                        </div>
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
                            <span className="w-9 tabular-nums font-semibold text-ink">
                              {pct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">{EM_DASH}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          {reportUrl ? (
                            <a
                              href={reportUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-brand-strong hover:underline"
                            >
                              View report
                            </a>
                          ) : hasReportLink && reportDead ? (
                            <span className="text-xs text-muted line-through">View report</span>
                          ) : null}
                          {hasReportLink ? (
                            reportDead ? (
                              <button
                                type="button"
                                onClick={() => handleReportLink("renew", token)}
                                disabled={linkPending !== null}
                                className="text-xs font-semibold text-brand-strong hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                                title="Re-enables the same report URL for 90 days"
                              >
                                {linkPending === `${token}:renew`
                                  ? "Renewing..."
                                  : "Renew link (90 days)"}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleReportLink("revoke", token)}
                                disabled={linkPending !== null}
                                className="text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                                title="Stops this candidate report link from opening"
                              >
                                {linkPending === `${token}:revoke` ? "Revoking..." : "Revoke link"}
                              </button>
                            )
                          ) : null}
                          {link ? <CopyButton value={link} label="Copy link" /> : null}
                          {resendable ? (
                            <button
                              type="button"
                              onClick={() => handleResend(token)}
                              disabled={resendingToken === token}
                              className="text-xs font-semibold text-brand-strong hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                              title="Re-sends the candidate's magic-link email (no credit charged)"
                            >
                              {resendingToken === token ? "Sending..." : "Resend email"}
                            </button>
                          ) : null}
                          {!revoked && token ? (
                            <button
                              type="button"
                              onClick={() => handleRevoke(token)}
                              disabled={revokingToken === token}
                              className="text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                              title="Revokes the candidate's invite"
                            >
                              {revokingToken === token ? "Revoking..." : "Revoke"}
                            </button>
                          ) : null}
                          {token ? (
                            problemSent[token] ? (
                              <span className="text-xs font-medium text-emerald-700">
                                Problem reported
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openProblemForm(token)}
                                className="text-xs font-semibold text-ink-soft hover:text-brand-strong hover:underline"
                              >
                                Report a problem
                              </button>
                            )
                          ) : null}
                        </div>
                        {hasReportLink && reportDead ? (
                          <p className="mt-1 text-right text-[11px] text-muted">
                            {invite.candidateReportRevokedAt
                              ? "Report link revoked "
                              : "Report link expired "}
                            {EM_DASH} renew to re-enable. A leaked link should stay revoked.
                          </p>
                        ) : null}
                        {resendNote ? (
                          <p
                            className={`mt-1 text-right text-[11px] ${
                              resendNote.ok ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {resendNote.text}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                    {problemOpen && token ? (
                      <tr className="border-b border-line bg-canvas/60 last:border-b-0">
                        <td colSpan={4} className="px-4 py-4">
                          <p className="text-xs font-medium text-ink-soft">
                            Report a problem with{" "}
                            {invite.candidateName ?? "this candidate"}&apos;s assessment
                          </p>
                          <textarea
                            value={problemText}
                            onChange={(e) => setProblemText(e.target.value)}
                            maxLength={PROBLEM_MAX_CHARS}
                            rows={3}
                            placeholder="What went wrong? (lab issue, scoring dispute, candidate could not start...)"
                            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                          />
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-muted">
                              {problemText.length}/{PROBLEM_MAX_CHARS}
                            </span>
                            <div className="flex items-center gap-3">
                              {problemError ? (
                                <span className="text-xs text-rose-700">{problemError}</span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => setProblemFor(null)}
                                disabled={problemPending}
                                className="text-xs font-semibold text-ink-soft hover:underline disabled:opacity-60"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleProblemSubmit(token)}
                                disabled={problemPending}
                                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {problemPending ? "Sending..." : "Send report"}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </SingleRow>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Keyed fragment wrapper: lets each candidate render its main row plus the
// optional inline problem-form row under ONE key inside <tbody>.
function SingleRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
