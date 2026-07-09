import type { Metadata } from "next";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import {
  Bar,
  PreliminaryBanner,
  RankBadge,
  ReportHeader,
  ReportNotFound,
  ReportShell,
  correctnessPct,
  formatDate,
} from "../_components/report-bits";

// Employer-facing comparison report — never indexed, never cached (each view
// reflects live grading state as candidates submit).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Force dynamic rendering so this route is always re-fetched from the engine
// on every request (no static optimization / ISR). Combined with entFetch's
// own `cache: "no-store"`, the response should also be served with
// `Cache-Control: no-store` — Next sets this automatically for
// force-dynamic routes that read no cacheable data, but if a CDN in front of
// this Worker ever caches by default, add the header explicitly here.
export const dynamic = "force-dynamic";

type ResultRow = {
  assessmentId?: string;
  inviteToken?: string;
  candidateName?: string | null;
  composite?: number;
  correctness?: number;
  dims?: Record<string, string>;
  criteria?: Array<{ id?: string; description?: string; passed?: boolean; unknown?: boolean }>;
  passedCount?: number;
  totalCriteria?: number;
  reflectionText?: string | null;
  reflectionScore?: number | null;
  integrity?: string;
  gradedAt?: string;
  gradeError?: string;
};

type ReportData = {
  assessment?: { name?: string; labSlug?: string; createdAt?: string };
  results?: ResultRow[];
};

export default async function AssessmentReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let data: ReportData | undefined;
  try {
    data = await entFetch<ReportData>("/ent/report", { query: { reportToken: token } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return <ReportNotFound context="assessment" />;
    }
    // Any other engine failure (5xx, network) — fail closed with the same
    // not-found-style page rather than leaking a stack trace to an employer.
    return <ReportNotFound context="assessment" />;
  }

  const assessment = data?.assessment;
  const results = Array.isArray(data?.results) ? data!.results! : [];

  const rows = results
    .map((r) => ({ row: r, pct: correctnessPct(r?.passedCount, r?.totalCriteria) }))
    .sort((a, b) => b.pct - a.pct);

  const total = rows.length;
  const withReflection = rows.filter(
    ({ row }) => Boolean(row?.reflectionText && row.reflectionText.trim().length > 0)
  ).length;
  const avgPct = total ? Math.round(rows.reduce((s, { pct }) => s + pct, 0) / total) : 0;

  return (
    <ReportShell>
      <ReportHeader
        eyebrow="Assessment report"
        title={assessment?.name ?? "Assessment report"}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {assessment?.labSlug ? (
              <span className="inline-flex items-center rounded-md bg-canvas px-2 py-0.5 font-mono text-xs text-ink-soft ring-1 ring-inset ring-line-strong/60">
                {assessment.labSlug}
              </span>
            ) : null}
            {assessment?.createdAt ? <span>Created {formatDate(assessment.createdAt)}</span> : null}
          </span>
        }
      />

      {total > 0 ? (
        <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-md">
          <StatCard label="Candidates" value={String(total)} />
          <StatCard label="Avg correctness" value={`${avgPct}%`} />
          <StatCard label="With reflection" value={`${withReflection}/${total}`} />
        </div>
      ) : null}

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/5 text-brand ring-1 ring-inset ring-brand/15">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <p className="font-semibold text-ink">No submissions yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
            No candidates have completed this assessment yet. Results appear here automatically as
            each candidate submits.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <th className="px-5 py-3.5">Rank</th>
                  <th className="px-5 py-3.5">Candidate</th>
                  <th className="px-5 py-3.5">Objectives</th>
                  <th className="px-5 py-3.5">Correctness</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-center">Reflection</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, pct }, i) => {
                  const rank = i + 1;
                  const label =
                    row?.candidateName && row.candidateName.trim()
                      ? row.candidateName.trim()
                      : row?.inviteToken
                        ? `${row.inviteToken.slice(0, 8)}…`
                        : `candidate-${rank}`;
                  const passed = row?.passedCount ?? 0;
                  const totalCriteria = row?.totalCriteria ?? 0;
                  const hasReflection = Boolean(
                    row?.reflectionText && row.reflectionText.trim().length > 0
                  );
                  return (
                    <tr
                      key={row?.inviteToken ?? i}
                      className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-canvas/60"
                    >
                      <td className="px-5 py-4">
                        <RankBadge rank={rank} />
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-ink">{label}</td>
                      <td className="px-5 py-4 tabular-nums text-ink-soft">
                        {totalCriteria ? `${passed} / ${totalCriteria}` : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-28">
                            <Bar pct={pct} />
                          </div>
                          <span className="w-10 tabular-nums font-semibold text-ink">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                          Submitted
                        </span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        {hasReflection ? (
                          <span
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200"
                            title="Written reflection submitted"
                          >
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                              <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="sr-only">Reflection submitted</span>
                          </span>
                        ) : (
                          <span className="text-muted" aria-label="No reflection">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Candidates are ranked by verified objective correctness on a real, isolated AWS environment.
        Each candidate&apos;s full per-objective breakdown and written reasoning is on their individual
        report link.
      </p>
    </ReportShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="text-lg font-bold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
