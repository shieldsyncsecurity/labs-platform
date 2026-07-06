import type { Metadata } from "next";
import Link from "next/link";
import {
  Bar,
  PassBadge,
  PreliminaryBanner,
  FinalizingPill,
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
    <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="font-semibold">Sample report.</span> Every candidate and score below is
      fictional, shown to illustrate what employers receive. Real reports are private, per-assessment
      secret links.
    </div>
  );
}

export default function DemoReportPage() {
  const rows = [...CANDIDATES]
    .map((c) => ({ c, pct: correctnessPct(c.passedCount, c.totalCriteria) }))
    .sort((a, b) => b.pct - a.pct);

  const detailPct = correctnessPct(DETAIL_CRITERIA.filter((x) => x.passed).length, DETAIL_CRITERIA.length);

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <SampleRibbon />

      {/* ── Comparison view (what /r/[token] shows) ── */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">{ASSESSMENT.name}</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="font-mono">{ASSESSMENT.labSlug}</span>
          {" · "}
          <span>Created {formatDate(ASSESSMENT.createdAt)}</span>
        </p>
      </header>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold">Candidate</th>
              <th className="px-4 py-3 font-semibold">Objectives</th>
              <th className="px-4 py-3 font-semibold">Correctness</th>
              <th className="px-4 py-3 font-semibold">Time</th>
              <th className="px-4 py-3 font-semibold">Reflection</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, pct }) => (
              <tr key={c.name} className="border-b border-line last:border-b-0">
                <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                <td className="px-4 py-3 text-ink-soft">
                  {c.passedCount} / {c.totalCriteria}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-24">
                      <Bar pct={pct} />
                    </div>
                    <span className="tabular-nums text-ink-soft">{pct}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft">{c.timeUsedMin} min</td>
                <td className="px-4 py-3">
                  {c.hasReflection ? (
                    <span className="text-emerald-700">{"✓"}</span>
                  ) : (
                    <span className="text-muted">{"—"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-muted">
        Candidates are ranked by verified performance on a real, isolated AWS environment — not a
        quiz. Each row links to a full per-candidate breakdown (shown below).
      </p>

      {/* ── Candidate detail (what /r/c/[token] shows) ── */}
      <div className="my-12 border-t border-line" />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-muted">Inside a candidate&apos;s report</p>
        <h2 className="mt-1 text-xl font-bold text-ink sm:text-2xl">Priya S.</h2>
      </header>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      <div className="mb-8 rounded-xl border border-line bg-surface px-6 py-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted">Correctness</span>
          <span className="text-2xl font-bold text-ink">
            {DETAIL_CRITERIA.filter((x) => x.passed).length} / {DETAIL_CRITERIA.length}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Bar pct={detailPct} />
          <span className="tabular-nums text-sm text-ink-soft">{detailPct}%</span>
        </div>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-ink">Objectives</h3>
      <div className="mb-8 overflow-hidden rounded-xl border border-line bg-surface">
        <ul className="divide-y divide-line">
          {DETAIL_CRITERIA.map((crit, i) => (
            <li key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm text-ink-soft">{crit.description}</span>
              <PassBadge passed={crit.passed} unknown={crit.unknown} />
            </li>
          ))}
        </ul>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-ink">Written reflection</h3>
      <blockquote className="mb-3 rounded-xl border border-line bg-canvas px-5 py-4 text-sm italic text-ink-soft">
        {DETAIL_REFLECTION}
      </blockquote>
      <p className="mb-8 text-xs text-muted">AI reflection scoring: finalizing.</p>

      <h3 className="mb-3 text-sm font-semibold text-ink">Other dimensions</h3>
      <div className="mb-12 flex flex-wrap gap-3">
        {["Solution quality", "Speed", "Process", "Integrity"].map((d) => (
          <div key={d} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-soft">
            <span>{d}</span>
            <FinalizingPill />
          </div>
        ))}
      </div>

      {/* ── CTA ── */}
      <div className="rounded-2xl border border-brand/20 bg-brand/5 px-6 py-8 text-center">
        <h2 className="text-xl font-bold text-ink">This is what you get for every candidate.</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-soft">
          Send a link, the candidate solves a real cloud security task in an isolated AWS account, and
          you get a verified, side-by-side report. No résumé guesswork.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
        >
          Book a walkthrough
        </Link>
      </div>
    </div>
  );
}
