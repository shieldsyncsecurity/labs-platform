import type { Metadata } from "next";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import {
  Bar,
  FinalizingPill,
  PassBadge,
  PreliminaryBanner,
  ReportNotFound,
  correctnessPct,
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
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold text-ink">{data?.candidateName ?? "Candidate"}</h1>
        <p className="mt-3 text-ink-soft">
          This candidate has not submitted their assessment yet. Check back after they finish.
        </p>
      </div>
    );
  }

  const passed = result.passedCount ?? 0;
  const total = result.totalCriteria ?? 0;
  const pct = correctnessPct(result.passedCount, result.totalCriteria);
  const criteria = Array.isArray(result.criteria) ? result.criteria : [];
  const reflectionText = result.reflectionText?.trim();
  const dims = result.dims ?? {};

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">
          {data?.candidateName ?? "Candidate report"}
        </h1>
        {result.gradedAt ? (
          <p className="mt-1 text-sm text-muted">Graded {new Date(result.gradedAt).toLocaleString()}</p>
        ) : null}
      </header>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      <section className="mb-8 rounded-xl border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Correctness</h2>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-3xl font-bold text-ink">
            {total ? `${passed} / ${total}` : "—"}
          </span>
          <span className="text-sm text-ink-soft">objectives passed</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1">
            <Bar pct={pct} />
          </div>
          <span className="tabular-nums text-sm font-semibold text-ink-soft">{pct}%</span>
        </div>
        {result.gradeError ? (
          <p className="mt-3 text-xs text-amber-700">
            Note: grading encountered an issue capturing full evidence for this run ({result.gradeError}).
          </p>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Objective breakdown
        </h2>
        {criteria.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface px-6 py-8 text-center text-ink-soft">
            No objective results are available for this run.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <tbody>
                {criteria.map((c, i) => (
                  <tr key={c?.id ?? i} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 text-ink-soft">
                      {c?.description ?? c?.id ?? `Objective ${i + 1}`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <PassBadge passed={c?.passed} unknown={c?.unknown} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Reflection</h2>
        <div className="rounded-xl border border-line bg-surface p-6">
          {reflectionText ? (
            <blockquote className="border-l-2 border-brand/40 pl-4 text-ink-soft italic">
              {reflectionText}
            </blockquote>
          ) : (
            <p className="text-ink-soft">No written reflection submitted.</p>
          )}
          <p className="mt-4 text-xs text-muted">AI reflection scoring: finalizing.</p>
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
              className="flex flex-col items-start gap-2 rounded-xl border border-line bg-surface p-4"
            >
              <span className="text-sm font-medium text-ink">{label}</span>
              <FinalizingPill />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
