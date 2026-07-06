import type { Metadata } from "next";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import {
  Bar,
  FinalizingPill,
  PassBadge,
  PreliminaryBanner,
  ReportHeader,
  ReportNotFound,
  ReportShell,
  correctnessPct,
  formatDate,
} from "../../_components/report-bits";

// Employer-facing single-candidate report — never indexed, never cached.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// See app/r/[token]/page.tsx for the force-dynamic / no-store rationale —
// same applies here: this route must always reflect live grading state.
export const dynamic = "force-dynamic";

type CriterionRow = { id?: string; description?: string; passed?: boolean; unknown?: boolean };

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
};

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

  const passed = result.passedCount ?? 0;
  const total = result.totalCriteria ?? 0;
  const pct = correctnessPct(result.passedCount, result.totalCriteria);
  const criteria = Array.isArray(result.criteria) ? result.criteria : [];
  const reflectionText = result.reflectionText?.trim();
  const dims = result.dims ?? {};

  const passedCriteria = criteria.filter((c) => c?.passed).length;

  return (
    <ReportShell>
      <div className="mx-auto max-w-3xl">
        <ReportHeader
          eyebrow="Candidate report"
          title={data?.candidateName ?? "Candidate report"}
          meta={
            result.gradedAt ? (
              <span>Graded {formatDate(result.gradedAt)}</span>
            ) : null
          }
        />

        <div className="mb-8">
          <PreliminaryBanner />
        </div>

        <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line bg-gradient-to-br from-brand/[0.05] to-cyan/[0.03] px-6 py-6 sm:px-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
              Objective correctness
            </h2>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold tabular-nums leading-none text-ink">
                  {total ? passed : "—"}
                </span>
                {total ? (
                  <span className="text-2xl font-semibold tabular-nums text-muted">/ {total}</span>
                ) : null}
                <span className="ml-1 text-sm text-ink-soft">objectives passed</span>
              </div>
              <span className="text-4xl font-bold tabular-nums text-brand">{pct}%</span>
            </div>
            <div className="mt-5">
              <Bar pct={pct} />
            </div>
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
              Objective breakdown
            </h2>
            {criteria.length ? (
              <span className="font-mono text-xs text-muted">
                {passedCriteria}/{criteria.length} passed
              </span>
            ) : null}
          </div>
          {criteria.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center text-ink-soft">
              No objective results are available for this run.
            </div>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              {criteria.map((c, i) => (
                <li
                  key={c?.id ?? i}
                  className="flex items-center justify-between gap-4 border-b border-line/70 px-5 py-4 transition-colors last:border-b-0 hover:bg-canvas/60"
                >
                  <span className="text-sm text-ink-soft">
                    {c?.description ?? c?.id ?? `Objective ${i + 1}`}
                  </span>
                  <span className="flex-none">
                    <PassBadge passed={c?.passed} unknown={c?.unknown} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

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
            <p className="mt-5 flex items-center gap-2 border-t border-line/70 pt-4 text-xs text-muted">
              <span>AI reflection scoring</span>
              <FinalizingPill />
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Other dimensions
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Quality", dims.quality],
                ["Speed", dims.speed],
                ["Process", dims.process],
                ["Integrity", result.integrity],
              ] as const
            ).map(([label]) => (
              <div
                key={label}
                className="flex flex-col items-start gap-2.5 rounded-xl border border-line bg-surface p-4 shadow-sm"
              >
                <span className="text-sm font-medium text-ink">{label}</span>
                <FinalizingPill />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            These signals are computed after correctness and will populate automatically.
          </p>
        </section>
      </div>
    </ReportShell>
  );
}
