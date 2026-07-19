"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CompetencyChips,
  RankBadge,
  correctnessPct,
  type ReportCriterion,
} from "../../r/_components/report-bits";

/* Interactive slice of the sample report — the ranked comparison table with the
 * filters an employer actually reaches for (top performers, reflection
 * submitted). Client-side state on fictional data; the real /r/[token] report
 * gets the same treatment as those filters ship there. */

export type DemoCandidate = {
  name: string;
  role: string;
  passedCount: number;
  totalCriteria: number;
  timeUsedMin: number;
  hasReflection: boolean;
  /** Only the expanded sample candidate links to the detail section below. */
  detailAnchor?: string;
  /** Per-check results, tagged by competency dimension (for the inline chips). */
  criteria?: ReportCriterion[];
};

type FilterKey = "all" | "top" | "reflection";

const FILTERS: { key: FilterKey; label: string; hint: string }[] = [
  { key: "all", label: "All candidates", hint: "Everyone who submitted" },
  { key: "top", label: "Top performers", hint: "5+ of 6 checks verified" },
  { key: "reflection", label: "With reflection", hint: "Submitted the written walkthrough" },
];

export function DemoComparisonTable({ candidates }: { candidates: DemoCandidate[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const ranked = useMemo(
    () =>
      [...candidates]
        .map((c) => ({ c, pct: correctnessPct(c.passedCount, c.totalCriteria) }))
        .sort((a, b) => b.pct - a.pct)
        .map((row, i) => ({ ...row, rank: i + 1 })),
    [candidates],
  );

  const rows = ranked.filter(({ c }) => {
    if (filter === "top") return c.passedCount >= 5;
    if (filter === "reflection") return c.hasReflection;
    return true;
  });

  return (
    <div>
      {/* Filter chips */}
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter candidates">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            title={f.hint}
            aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              filter === f.key
                ? "border-brand/40 bg-brand/10 text-brand-strong"
                : "border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">
          {rows.length} of {ranked.length} shown
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3.5">Rank</th>
                <th className="px-4 py-3.5">Candidate &amp; competencies</th>
                <th className="px-4 py-3.5">Checks</th>
                <th className="px-4 py-3.5">Correctness</th>
                <th className="px-4 py-3.5">Time used</th>
                <th className="px-4 py-3.5">Status</th>
                <th
                  className="px-4 py-3.5 text-center"
                  title="Reflection = the candidate's own 3-5 sentence account of what they found and how they fixed it."
                >
                  Reflection
                </th>
                <th className="px-4 py-3.5 text-right">Report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, pct, rank }) => (
                <tr
                  key={c.name}
                  className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-canvas/60"
                >
                  <td className="px-4 py-4">
                    <RankBadge rank={rank} />
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-xs text-muted">{c.role}</div>
                    {c.criteria && c.criteria.length > 0 ? (
                      <div className="mt-1.5">
                        <CompetencyChips criteria={c.criteria} />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 tabular-nums text-ink-soft">
                    {c.passedCount} / {c.totalCriteria}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-24">
                        <Bar pct={pct} />
                      </div>
                      <span className="w-10 tabular-nums font-semibold text-ink">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 tabular-nums text-ink-soft">
                    {c.timeUsedMin} min <span className="text-xs text-muted">/ 60</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Submitted
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {c.hasReflection ? (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200">
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="sr-only">Reflection submitted</span>
                      </span>
                    ) : (
                      <span className="text-muted" aria-label="No reflection">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {c.detailAnchor ? (
                      <a href={c.detailAnchor} className="text-sm font-semibold text-brand-strong hover:underline">
                        View →
                      </a>
                    ) : (
                      <span className="text-xs text-muted" title="Each candidate gets a private per-candidate report link">
                        Private link
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
