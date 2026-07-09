"use client";

import { useState } from "react";

// Client half of /admin/forensics: paste a token, POST it to the admin-gated
// /api/admin/forensics route, render the returned read-only dossier. The token
// goes in a POST body on purpose -- it is the candidate's live bearer
// credential (/a/<token>) and must never appear in a URL.

type Dossier = {
  invite: {
    status: string | null;
    candidateName: string | null;
    assessmentName: string | null;
    labSlug: string | null;
    orgName: string | null;
    slotKey: string | null;
    consentVersion: string | null;
    otpLocked: boolean;
    expiresAt: string | null;
  };
  timeline: {
    createdAt: string | null;
    consentAt: string | null;
    slotAt: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    erasedAt: string | null;
    revokedAt: string | null;
    candidateReportRevokedAt: string | null;
    candidateReportExpiresAt: string | null;
  };
  problems: Array<{ ts: string | null; message: string; actor: string | null }>;
  result: {
    passedCount: number;
    totalCriteria: number;
    reflectionScore: number | null;
    integrity: string | null;
    autoSubmitted: boolean;
    lateSubmit: boolean;
    secondsLate: number | null;
    gradedAt: string | null;
    gradeError: string | null;
  } | null;
};

function formatDateTime(value?: string | null): string {
  if (!value) return "\u2014";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "\u2014";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink-soft">{children}</dd>
    </div>
  );
}

function FlagPill({ tone, children }: { tone: "warn" | "bad" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "bad"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}

export default function ForensicsForm() {
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    setDossier(null);
    try {
      const res = await fetch("/api/admin/forensics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not look up that invite.");
        setPending(false);
        return;
      }
      setDossier(data as Dossier);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  const t = dossier?.timeline;
  const timelineSteps: Array<{ label: string; at: string | null }> = t
    ? [
        { label: "Invited", at: t.createdAt },
        { label: "Consented", at: t.consentAt },
        { label: "Slot booked", at: t.slotAt },
        { label: "Started", at: t.startedAt },
        { label: "Submitted", at: t.submittedAt },
      ]
    : [];

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3">
        <input
          id="forensicsToken"
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="e.g. 3f9c8a1b..."
          className="w-full max-w-md rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={pending || !token.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Looking up..." : "Look up"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}

      {dossier ? (
        <div className="mt-6 space-y-5">
          {/* Invite summary */}
          <div className="rounded-xl border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {dossier.invite.candidateName || "(no name)"}
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <FlagPill tone={dossier.invite.status === "submitted" ? "ok" : "warn"}>
                  {dossier.invite.status ?? "unknown"}
                </FlagPill>
                {dossier.invite.otpLocked ? <FlagPill tone="bad">OTP locked</FlagPill> : null}
                {t?.erasedAt ? <FlagPill tone="bad">PII erased</FlagPill> : null}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Organization">{dossier.invite.orgName ?? "\u2014"}</Field>
              <Field label="Assessment">
                {dossier.invite.assessmentName ?? "\u2014"}
                {dossier.invite.labSlug ? (
                  <span className="ml-2 font-mono text-xs text-muted">{dossier.invite.labSlug}</span>
                ) : null}
              </Field>
              <Field label="Slot">
                {dossier.invite.slotKey ? (
                  <span className="font-mono text-xs">{dossier.invite.slotKey}</span>
                ) : (
                  "Not booked"
                )}
              </Field>
              <Field label="Link expires">{formatDateTime(dossier.invite.expiresAt)}</Field>
              <Field label="Consent version">{dossier.invite.consentVersion ?? "\u2014"}</Field>
              <Field label="Candidate report">
                {t?.candidateReportRevokedAt
                  ? `Revoked ${formatDateTime(t.candidateReportRevokedAt)}`
                  : t?.candidateReportExpiresAt
                    ? `Valid until ${formatDateTime(t.candidateReportExpiresAt)}`
                    : "\u2014"}
              </Field>
            </dl>
          </div>

          {/* Timeline */}
          <div className="rounded-xl border border-line bg-canvas p-4">
            <h3 className="text-sm font-semibold text-ink">Timeline</h3>
            <ol className="mt-3 space-y-1.5">
              {timelineSteps.map((step) => (
                <li key={step.label} className="flex items-center justify-between gap-4 text-sm">
                  <span className={step.at ? "text-ink-soft" : "text-muted"}>{step.label}</span>
                  <span className={`tabular-nums text-xs ${step.at ? "text-ink" : "text-muted"}`}>
                    {formatDateTime(step.at)}
                  </span>
                </li>
              ))}
              {t?.erasedAt ? (
                <li className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-rose-700">PII erased</span>
                  <span className="tabular-nums text-xs text-rose-700">
                    {formatDateTime(t.erasedAt)}
                  </span>
                </li>
              ) : null}
            </ol>
          </div>

          {/* Problems log */}
          <div className="rounded-xl border border-line bg-canvas p-4">
            <h3 className="text-sm font-semibold text-ink">
              Reported problems
              <span className="ml-2 text-xs font-normal text-muted">
                {dossier.problems.length} of max 10 kept
              </span>
            </h3>
            {dossier.problems.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No problems reported on this invite.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {dossier.problems.map((p, i) => (
                  <li key={i} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span className="font-medium text-ink-soft">{p.actor ?? "unknown"}</span>
                      <span className="tabular-nums">{formatDateTime(p.ts)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-soft">{p.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Score summary */}
          <div className="rounded-xl border border-line bg-canvas p-4">
            <h3 className="text-sm font-semibold text-ink">Score summary</h3>
            {!dossier.result ? (
              <p className="mt-2 text-sm text-muted">
                No stored result &mdash; this candidate has not submitted yet.
              </p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {dossier.result.autoSubmitted ? (
                    <FlagPill tone="warn">Auto-submitted</FlagPill>
                  ) : null}
                  {dossier.result.lateSubmit ? (
                    <FlagPill tone="warn">
                      Late submit
                      {dossier.result.secondsLate != null
                        ? ` (+${dossier.result.secondsLate}s)`
                        : ""}
                    </FlagPill>
                  ) : null}
                  {dossier.result.gradeError ? (
                    <FlagPill tone="bad">{dossier.result.gradeError}</FlagPill>
                  ) : null}
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Objectives">
                    <span className="tabular-nums font-semibold text-ink">
                      {dossier.result.passedCount} / {dossier.result.totalCriteria}
                    </span>{" "}
                    passed
                  </Field>
                  <Field label="Graded at">{formatDateTime(dossier.result.gradedAt)}</Field>
                  <Field label="Integrity">{dossier.result.integrity ?? "\u2014"}</Field>
                  <Field label="Reflection score">
                    {dossier.result.reflectionScore != null
                      ? String(dossier.result.reflectionScore)
                      : "Pending"}
                  </Field>
                </dl>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
