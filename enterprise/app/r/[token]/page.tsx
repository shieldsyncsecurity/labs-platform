import type { Metadata } from "next";
import Link from "next/link";
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

// Employer-facing comparison report -- never indexed, never cached (each view
// reflects live grading state as candidates submit).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// Force dynamic rendering so this route is always re-fetched from the engine
// on every request (no static optimization / ISR). Combined with entFetch's
// own `cache: "no-store"`, the response should also be served with
// `Cache-Control: no-store` -- Next sets this automatically for
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

// One row per non-revoked invite (engine E3). `id` is an 8-char display
// prefix -- NEVER a live token; `candidateReportToken` rides only on
// submitted rows and is the only token-shaped value we may render (as a
// link href, never as text).
type RosterRow = {
  id?: string;
  candidateName?: string | null;
  status?: string; // Invited | Scheduled | In progress | Submitted | Expired
  createdAt?: string;
  slotKey?: string;
  submittedAt?: string;
  candidateReportToken?: string;
};

type ReportData = {
  assessment?: { name?: string; labSlug?: string; createdAt?: string };
  results?: ResultRow[];
  roster?: RosterRow[];
};

// Unified table row: scored (submitted + graded) rows carry rank/bar data;
// pending roster rows carry only a status chip.
type DisplayRow = {
  key: string;
  name: string;
  status: string;
  rank?: number;
  pct?: number;
  passed?: number;
  totalCriteria?: number;
  hasReflection?: boolean;
  breakdownToken?: string;
};

// Ranked ordering after the scored rows: submitted-awaiting-grade first,
// then in-progress / scheduled / invited, expired last.
const STATUS_ORDER: Record<string, number> = {
  Submitted: 0,
  "In progress": 1,
  Scheduled: 2,
  Invited: 3,
  Expired: 4,
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
    // Any other engine failure (5xx, network) -- fail closed with the same
    // not-found-style page rather than leaking a stack trace to an employer.
    return <ReportNotFound context="assessment" />;
  }

  const assessment = data?.assessment;
  const results = Array.isArray(data?.results) ? data!.results! : [];
  // null = engine response without roster (stale cache / older engine):
  // fall back to the legacy submitted-only table gracefully.
  const roster = Array.isArray(data?.roster) ? data!.roster! : null;

  const scored = results
    .map((r) => ({ row: r, pct: correctnessPct(r?.passedCount, r?.totalCriteria) }))
    .sort((a, b) => b.pct - a.pct);

  // Join each graded result to its roster row via the 8-char invite prefix
  // (roster.id is exactly inviteToken.slice(0, 8) on the engine side).
  const rosterById = new Map<string, RosterRow>();
  if (roster) {
    for (const r of roster) {
      if (r?.id) rosterById.set(r.id, r);
    }
  }

  const matchedIds = new Set<string>();
  const displayRows: DisplayRow[] = scored.map(({ row, pct }, i) => {
    const prefix = row?.inviteToken ? row.inviteToken.slice(0, 8) : "";
    const rosterRow = prefix ? rosterById.get(prefix) : undefined;
    if (rosterRow?.id) matchedIds.add(rosterRow.id);
    const name =
      (row?.candidateName && row.candidateName.trim()) ||
      (rosterRow?.candidateName && rosterRow.candidateName.trim()) ||
      (prefix ? `${prefix}\u2026` : `candidate-${i + 1}`);
    return {
      key: rosterRow?.id ?? (prefix || `result-${i + 1}`),
      name,
      status: "Submitted",
      rank: i + 1,
      pct,
      passed: row?.passedCount ?? 0,
      totalCriteria: row?.totalCriteria ?? 0,
      hasReflection: Boolean(row?.reflectionText && row.reflectionText.trim().length > 0),
      breakdownToken: rosterRow?.candidateReportToken,
    };
  });

  // Roster rows without a graded result: submitted-awaiting-grade, then
  // in progress / scheduled / invited, then expired. Stable sort keeps the
  // engine's order within each status group.
  if (roster) {
    const pending = roster
      .filter((r): r is RosterRow & { id: string } => Boolean(r?.id) && !matchedIds.has(r!.id!))
      .sort(
        (a, b) => (STATUS_ORDER[a.status ?? ""] ?? 3) - (STATUS_ORDER[b.status ?? ""] ?? 3)
      );
    for (const r of pending) {
      displayRows.push({
        key: r.id,
        name: (r.candidateName && r.candidateName.trim()) || `${r.id}\u2026`,
        status: r.status && STATUS_ORDER[r.status] !== undefined ? r.status : "Invited",
      });
    }
  }

  const scoredCount = scored.length;
  const withReflection = displayRows.filter((r) => r.hasReflection).length;
  const avgPct = scoredCount
    ? Math.round(scored.reduce((s, { pct }) => s + pct, 0) / scoredCount)
    : 0;
  const submittedCount = roster
    ? roster.filter((r) => r?.status === "Submitted").length
    : scoredCount;
  const rosterTotal = roster ? roster.length : scoredCount;

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

      {displayRows.length > 0 ? (
        <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-md">
          <StatCard
            label="Submitted"
            value={roster ? `${submittedCount} of ${rosterTotal}` : String(scoredCount)}
          />
          <StatCard label="Avg correctness" value={scoredCount ? `${avgPct}%` : "\u2014"} />
          <StatCard
            label="With reflection"
            value={`${withReflection}/${Math.max(submittedCount, scoredCount)}`}
          />
        </div>
      ) : null}

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      {displayRows.length === 0 ? (
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
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <th className="px-5 py-3.5">Rank</th>
                  <th className="px-5 py-3.5">Candidate</th>
                  <th className="px-5 py-3.5">Objectives</th>
                  <th className="px-5 py-3.5">Correctness</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-center">Reflection</th>
                  <th className="px-5 py-3.5">Report</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r) => {
                  const isScored = typeof r.rank === "number";
                  return (
                    <tr
                      key={r.key}
                      className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-canvas/60"
                    >
                      <td className="px-5 py-4">
                        {isScored ? (
                          <RankBadge rank={r.rank!} />
                        ) : (
                          <span
                            className="inline-flex h-7 w-7 flex-none items-center justify-center text-muted"
                            aria-hidden="true"
                          >
                            &mdash;
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-ink">{r.name}</td>
                      <td className="px-5 py-4 tabular-nums text-ink-soft">
                        {isScored && r.totalCriteria
                          ? `${r.passed} / ${r.totalCriteria}`
                          : "\u2014"}
                      </td>
                      <td className="px-5 py-4">
                        {isScored ? (
                          <div className="flex items-center gap-3">
                            <div className="w-28">
                              <Bar pct={r.pct ?? 0} />
                            </div>
                            <span className="w-10 tabular-nums font-semibold text-ink">
                              {r.pct}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted">&mdash;</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <StatusChip status={r.status} />
                      </td>
                      <td className="px-5 py-4 text-center">
                        {r.hasReflection ? (
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
                          <span className="text-muted" aria-label="No reflection">&mdash;</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {r.breakdownToken ? (
                          <Link
                            href={`/r/c/${encodeURIComponent(r.breakdownToken)}`}
                            className="whitespace-nowrap text-xs font-semibold text-brand transition-colors hover:text-brand-strong"
                          >
                            Full breakdown &rarr;
                          </Link>
                        ) : (
                          <span className="text-muted">&mdash;</span>
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

// Muted, restrained status chips: only "Submitted" reads as done (emerald);
// everything pending stays quiet, matching the report's chip pattern.
const CHIP_STYLES: Record<string, { chip: string; dot: string }> = {
  Submitted: {
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  "In progress": {
    chip: "bg-amber-50 text-amber-800 ring-amber-200",
    dot: "bg-amber-500",
  },
  Scheduled: {
    chip: "bg-sky-50 text-sky-700 ring-sky-200",
    dot: "bg-sky-500",
  },
  Invited: {
    chip: "bg-canvas text-muted ring-line-strong/60",
    dot: "bg-line-strong",
  },
  Expired: {
    chip: "bg-rose-50 text-rose-600 ring-rose-200",
    dot: "bg-rose-400",
  },
};

function StatusChip({ status }: { status: string }) {
  const style = CHIP_STYLES[status] ?? CHIP_STYLES.Invited;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      {status}
    </span>
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
