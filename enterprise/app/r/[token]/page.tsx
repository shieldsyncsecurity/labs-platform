import type { Metadata } from "next";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import {
  Bar,
  PreliminaryBanner,
  ReportNotFound,
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">
          {assessment?.name ?? "Assessment report"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {assessment?.labSlug ? <span className="font-mono">{assessment.labSlug}</span> : null}
          {assessment?.labSlug && assessment?.createdAt ? " · " : null}
          {assessment?.createdAt ? <span>Created {formatDate(assessment.createdAt)}</span> : null}
        </p>
      </header>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface px-6 py-12 text-center text-ink-soft">
          No candidates have completed this assessment yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Candidate</th>
                <th className="px-4 py-3 font-semibold">Objectives</th>
                <th className="px-4 py-3 font-semibold">Correctness</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Reflection</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, pct }, i) => {
                const label = row?.inviteToken ? `${row.inviteToken.slice(0, 8)}…` : `candidate-${i + 1}`;
                const passed = row?.passedCount ?? 0;
                const total = row?.totalCriteria ?? 0;
                const hasReflection = Boolean(row?.reflectionText && row.reflectionText.trim().length > 0);
                return (
                  <tr key={row?.inviteToken ?? i} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 font-mono text-ink">{label}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {total ? `${passed} / ${total}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-24">
                          <Bar pct={pct} />
                        </div>
                        <span className="tabular-nums text-ink-soft">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">Submitted</td>
                    <td className="px-4 py-3">
                      {hasReflection ? (
                        <span className="text-emerald-700">{"✓"}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-muted">
        Candidate labels above are shortened invite IDs. Each candidate&apos;s full name and a
        detailed breakdown are available on their individual report link (sent separately per
        candidate).
      </p>
    </div>
  );
}
