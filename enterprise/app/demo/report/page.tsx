import type { Metadata } from "next";
import {
  Bar,
  PassBadge,
  PreliminaryBanner,
  FinalizingPill,
  RankBadge,
  ReportHeader,
  ReportShell,
  WalkthroughCta,
  correctnessPct,
  formatDate,
} from "../../r/_components/report-bits";

// Public sales asset — an illustrative sample of the employer report, rendered
// with the SAME components as the real /r/[token] pages so prospects see exactly
// what they get. All data below is fictional. Indexable (unlike real reports).
export const metadata: Metadata = {
  title: "Sample assessment report — ShieldSync Enterprise",
  description:
    "See what a ShieldSync hiring-assessment report looks like: candidates ranked by verified performance on a real cloud security task.",
};

// ── Fictional data (illustrative only) ───────────────────────────────────────
const ASSESSMENT = {
  name: "Cloud Security Engineer — S3 & IAM Hardening",
  labSlug: "s3-misconfiguration-audit",
  createdAt: "2026-07-02",
};

type DemoCandidate = {
  name: string;
  passedCount: number;
  totalCriteria: number;
  timeUsedMin: number;
  hasReflection: boolean;
};

const CANDIDATES: DemoCandidate[] = [
  { name: "Priya S.", passedCount: 6, totalCriteria: 6, timeUsedMin: 41, hasReflection: true },
  { name: "Ananya K.", passedCount: 5, totalCriteria: 6, timeUsedMin: 52, hasReflection: true },
  { name: "Rahul M.", passedCount: 4, totalCriteria: 6, timeUsedMin: 58, hasReflection: true },
  { name: "Vikram T.", passedCount: 2, totalCriteria: 6, timeUsedMin: 60, hasReflection: false },
];

// One expanded candidate detail (what /r/c/[token] shows).
const DETAIL_CRITERIA: Array<{ description: string; passed?: boolean; unknown?: boolean }> = [
  { description: "Public access blocked on all data buckets (account-level + per-bucket)", passed: true },
  { description: "Server-side encryption enforced (SSE-KMS) on the data bucket", passed: true },
  { description: "Bucket policy requires TLS (aws:SecureTransport) for all requests", passed: true },
  { description: "Over-broad s3:* on the pipeline IAM user replaced with least-privilege actions", passed: true },
  { description: "Access scoped to the specific bucket ARN (no Resource \"*\")", passed: true },
  { description: "Wildcard admin policy detached from the deployer role", passed: true },
];

const DETAIL_REFLECTION =
  "The data bucket was public and unencrypted, and the pipeline user had s3:* on all resources. " +
  "I blocked public access at the account and bucket level, enforced SSE-KMS, and added a TLS-only " +
  "bucket policy. For IAM, I replaced the wildcard with the five actions the pipeline actually uses, " +
  "scoped to the bucket ARN, and detached the admin policy so a leaked key can't escalate.";

function SampleRibbon() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 text-sm text-amber-900 sm:px-5">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path d="M8 2.5l6 11H2l6-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
        </svg>
      </span>
      <p>
        <span className="font-semibold">Sample report.</span> Every candidate and score below is
        fictional, shown to illustrate what employers receive. Real reports are private,
        per-assessment secret links.
      </p>
    </div>
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

export default function DemoReportPage() {
  const rows = [...CANDIDATES]
    .map((c) => ({ c, pct: correctnessPct(c.passedCount, c.totalCriteria) }))
    .sort((a, b) => b.pct - a.pct);

  const total = rows.length;
  const withReflection = rows.filter(({ c }) => c.hasReflection).length;
  const avgPct = total ? Math.round(rows.reduce((s, { pct }) => s + pct, 0) / total) : 0;

  const detailPassed = DETAIL_CRITERIA.filter((x) => x.passed).length;
  const detailPct = correctnessPct(detailPassed, DETAIL_CRITERIA.length);

  return (
    <ReportShell ribbon={<SampleRibbon />}>
      {/* ── Comparison view (what /r/[token] shows) ── */}
      <ReportHeader
        eyebrow="Assessment report"
        title={ASSESSMENT.name}
        meta={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center rounded-md bg-canvas px-2 py-0.5 font-mono text-xs text-ink-soft ring-1 ring-inset ring-line-strong/60">
              {ASSESSMENT.labSlug}
            </span>
            <span>Created {formatDate(ASSESSMENT.createdAt)}</span>
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-3 gap-3 sm:max-w-md">
        <StatCard label="Candidates" value={String(total)} />
        <StatCard label="Avg correctness" value={`${avgPct}%`} />
        <StatCard label="With reflection" value={`${withReflection}/${total}`} />
      </div>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                <th className="px-5 py-3.5">Rank</th>
                <th className="px-5 py-3.5">Candidate</th>
                <th className="px-5 py-3.5">Objectives</th>
                <th className="px-5 py-3.5">Correctness</th>
                <th className="px-5 py-3.5">Time</th>
                <th className="px-5 py-3.5 text-center">Reflection</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, pct }, i) => (
                <tr
                  key={c.name}
                  className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-canvas/60"
                >
                  <td className="px-5 py-4">
                    <RankBadge rank={i + 1} />
                  </td>
                  <td className="px-5 py-4 font-medium text-ink">{c.name}</td>
                  <td className="px-5 py-4 tabular-nums text-ink-soft">
                    {c.passedCount} / {c.totalCriteria}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-28">
                        <Bar pct={pct} />
                      </div>
                      <span className="w-10 tabular-nums font-semibold text-ink">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 tabular-nums text-ink-soft">{c.timeUsedMin} min</td>
                  <td className="px-5 py-4 text-center">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Candidates are ranked by verified performance on a real, isolated AWS environment — not a
        quiz. Each row links to a full per-candidate breakdown (shown below).
      </p>

      {/* ── Candidate detail (what /r/c/[token] shows) ── */}
      <div className="my-12 flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Inside a candidate&apos;s report
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="mx-auto max-w-3xl">
        <ReportHeader eyebrow="Candidate report" title="Priya S." meta={<span>Graded {formatDate(ASSESSMENT.createdAt)}</span>} />

        <div className="mb-8">
          <PreliminaryBanner />
        </div>

        <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line bg-gradient-to-br from-brand/[0.05] to-cyan/[0.03] px-6 py-6 sm:px-8">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
              Objective correctness
            </h3>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-bold tabular-nums leading-none text-ink">{detailPassed}</span>
                <span className="text-2xl font-semibold tabular-nums text-muted">/ {DETAIL_CRITERIA.length}</span>
                <span className="ml-1 text-sm text-ink-soft">objectives passed</span>
              </div>
              <span className="text-4xl font-bold tabular-nums text-brand">{detailPct}%</span>
            </div>
            <div className="mt-5">
              <Bar pct={detailPct} />
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Objective breakdown</h3>
            <span className="font-mono text-xs text-muted">
              {detailPassed}/{DETAIL_CRITERIA.length} passed
            </span>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            {DETAIL_CRITERIA.map((crit, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 border-b border-line/70 px-5 py-4 transition-colors last:border-b-0 hover:bg-canvas/60"
              >
                <span className="text-sm text-ink-soft">{crit.description}</span>
                <span className="flex-none">
                  <PassBadge passed={crit.passed} unknown={crit.unknown} />
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Written reflection</h3>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-7">
            <blockquote className="relative pl-5 text-ink-soft italic">
              <span
                className="absolute left-0 top-0 h-full w-1 rounded-full bg-gradient-to-b from-brand to-cyan"
                aria-hidden="true"
              />
              {DETAIL_REFLECTION}
            </blockquote>
            <p className="mt-5 flex items-center gap-2 border-t border-line/70 pt-4 text-xs text-muted">
              <span>AI reflection scoring</span>
              <FinalizingPill />
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Other dimensions</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {["Solution quality", "Speed", "Process", "Integrity"].map((d) => (
              <div
                key={d}
                className="flex flex-col items-start gap-2.5 rounded-xl border border-line bg-surface p-4 shadow-sm"
              >
                <span className="text-sm font-medium text-ink">{d}</span>
                <FinalizingPill />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── CTA ── */}
      <div className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/[0.07] via-surface to-cyan/[0.05] px-6 py-10 text-center shadow-sm sm:px-10 sm:py-12">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 h-48 w-96 -translate-x-1/2 rounded-full bg-brand/10 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative">
          <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            This is what you get for every candidate.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
            Send a link, the candidate solves a real cloud security task in an isolated AWS account,
            and you get a verified, side-by-side report. No résumé guesswork.
          </p>
          <div className="mt-6">
            <WalkthroughCta href="/" internal label="Book a walkthrough" />
          </div>
        </div>
      </div>
    </ReportShell>
  );
}
