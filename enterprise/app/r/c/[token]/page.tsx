import type { Metadata } from "next";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import {
  Bar,
  CompetencyProfile,
  PreliminaryBanner,
  ReportHeader,
  ReportNotFound,
  ReportShell,
  correctnessPct,
  formatDate,
  verifiedStats,
} from "../../_components/report-bits";
import { RecordingSection } from "./recording-section";
import { TimelineSection } from "./timeline-section";

// Employer-facing single-candidate report — never indexed, never cached.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// See app/r/[token]/page.tsx for the force-dynamic / no-store rationale —
// same applies here: this route must always reflect live grading state.
export const dynamic = "force-dynamic";

type CriterionRow = { id?: string; description?: string; passed?: boolean; unknown?: boolean; dimension?: string };

type CandidateResult = {
  assessmentId?: string;
  inviteToken?: string;
  composite?: number;
  correctness?: number;
  dims?: { quality?: string; speed?: string; process?: string; reflection?: string };
  criteria?: CriterionRow[];
  passedCount?: number;
  totalCriteria?: number;
  reflectionText?: string | null;
  reflectionScore?: number | null;
  integrity?: string;
  gradedAt?: string;
  gradeError?: string;
  // Completion facts (measured by the engine at submit) -- shown honestly, no scoring weight.
  autoSubmitted?: boolean;
  lateSubmit?: boolean;
  secondsLate?: number;
};

// How the candidate finished -- a measured fact (never a score input). "ok" = finished
// within the window; "warn" = ran out of time / went over. Null keeps the UI quiet if unknown.
function completionNote(r: CandidateResult): { label: string; tone: "ok" | "warn" } | null {
  if (r.autoSubmitted) return { label: "Auto-submitted at the time limit", tone: "warn" };
  if (r.lateSubmit) {
    const m = typeof r.secondsLate === "number" && r.secondsLate > 0 ? Math.max(1, Math.round(r.secondsLate / 60)) : null;
    return { label: m ? `Submitted ${m} min over the limit` : "Submitted after the limit", tone: "warn" };
  }
  return { label: "Submitted within the time limit", tone: "ok" };
}

type CandidateReportData = {
  candidateName?: string;
  result?: CandidateResult;
};

export default async function CandidateReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data: CandidateReportData | undefined;
  try {
    data = await entFetch<CandidateReportData>("/ent/report/candidate", {
      query: { candidateReportToken: token },
    });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return <ReportNotFound context="candidate" />;
    }
    return <ReportNotFound context="candidate" />;
  }

  const result = data?.result;
  // Guard: the invite may exist but have no result yet (not submitted).
  if (!result) {
    return (
      <ReportShell>
        <div className="mx-auto max-w-lg px-2 py-16 text-center sm:py-24">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7.5v5l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {data?.candidateName ?? "Candidate"}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-ink-soft">
            This candidate has not submitted their assessment yet. Their verified results will appear
            here automatically once they finish.
          </p>
        </div>
      </ReportShell>
    );
  }

  const criteria = Array.isArray(result.criteria) ? result.criteria : [];
  // Verified-only counts: "could not verify" checks are excluded from BOTH sides of the
  // ratio, so an unverifiable check never reads as a failure (and an all-unknown run is
  // "Not verified", not "0%"). Keeps the headline consistent with the per-competency pills.
  const { passed, total, hadUnknown } = verifiedStats(criteria, result.passedCount, result.totalCriteria);
  const pct = correctnessPct(passed, total);
  const reflectionText = result.reflectionText?.trim();

  return (
    <ReportShell>
      <div className="mx-auto max-w-3xl">
        <ReportHeader
          eyebrow="Candidate report"
          title={data?.candidateName ?? "Candidate report"}
          meta={
            <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              {result.gradedAt ? <span>Graded {formatDate(result.gradedAt)}</span> : null}
              {(() => {
                const c = completionNote(result);
                if (!c) return null;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      c.tone === "ok"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-amber-50 text-amber-800 ring-amber-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${c.tone === "ok" ? "bg-emerald-500" : "bg-amber-500"}`}
                      aria-hidden="true"
                    />
                    {c.label}
                  </span>
                );
              })()}
            </span>
          }
        />

        <div className="mb-8">
          <PreliminaryBanner />
        </div>

        <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line bg-gradient-to-br from-brand/[0.05] to-cyan/[0.03] px-6 py-6 sm:px-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
              Verified checks passed
            </h2>
            {total > 0 ? (
              <>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold tabular-nums leading-none text-ink">{passed}</span>
                    <span className="text-2xl font-semibold tabular-nums text-muted">/ {total}</span>
                    <span className="ml-1 text-sm text-ink-soft">checks passed</span>
                  </div>
                  <span className="text-2xl font-bold tabular-nums text-brand">{pct}%</span>
                </div>
                <div className="mt-5">
                  <Bar pct={pct} />
                </div>
                {hadUnknown ? (
                  <p className="mt-3 text-xs text-muted">
                    Some checks couldn&rsquo;t be verified on this run and are excluded from the ratio
                    above &mdash; they show as &ldquo;Not verified&rdquo; in the profile below.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                None of the automated checks could be verified on this run (a transient issue reaching
                the live environment). This is <span className="font-semibold text-ink">not a score of zero</span> &mdash;
                re-open the report shortly, or ask your ShieldSync contact to re-grade.
              </p>
            )}
          </div>
          {result.gradeError ? (
            <p className="flex items-start gap-2 px-6 py-3 text-xs text-amber-700 sm:px-8">
              <span aria-hidden="true">⚠</span>
              <span>
                Note: grading encountered an issue capturing full evidence for this run (
                {result.gradeError}).
              </span>
            </p>
          ) : null}
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Competency profile
            </h2>
            {criteria.length ? (
              <span className="font-mono text-xs text-muted">
                {total > 0 ? `${passed}/${total} verified` : `${criteria.length} not verified`}
                {hadUnknown && total > 0 ? ` · ${criteria.length - total} unverified` : ""}
              </span>
            ) : null}
          </div>
          {criteria.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center text-ink-soft">
              No verified results are available for this run.
            </div>
          ) : (
            <CompetencyProfile criteria={criteria} />
          )}
        </section>

        {/* Session recording (webcam snapshots + mic) — renders nothing for
            sessions recorded before this feature or with no captured media. */}
        <TimelineSection token={token} criteria={criteria} />

        <RecordingSection token={token} />

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Written reflection
          </h2>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-7">
            {reflectionText ? (
              <blockquote className="relative pl-5 text-ink-soft italic">
                <span
                  className="absolute left-0 top-0 h-full w-1 rounded-full bg-gradient-to-b from-brand to-cyan"
                  aria-hidden="true"
                />
                {reflectionText}
              </blockquote>
            ) : (
              <p className="text-ink-soft">No written reflection submitted.</p>
            )}
          </div>
        </section>
      </div>
    </ReportShell>
  );
}
