import type { Metadata } from "next";
import Link from "next/link";
import {
  Bar,
  CompetencyProfile,
  PreliminaryBanner,
  ReportHeader,
  ReportShell,
  WalkthroughCta,
  correctnessPct,
  formatDate,
} from "../../r/_components/report-bits";
import { DemoComparisonTable, type DemoCandidate } from "./demo-table";

// Public sales asset — an illustrative sample of the employer report, rendered
// with the SAME components as the real /r/[token] pages so prospects see exactly
// what they get. All data below is fictional. Indexable (unlike real reports —
// the explicit robots below overrides the layout's global noindex).
export const metadata: Metadata = {
  title: "Sample assessment report — ShieldSync Enterprise",
  description:
    "See what a ShieldSync hiring-assessment report looks like: candidates ranked by verified performance on a real cloud security task.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/demo/report" },
};

// ── Fictional data (illustrative only) ───────────────────────────────────────
// The parameters an employer sets when creating the assessment — surfaced on
// the report so a hiring panel reading it cold has full context.
const ASSESSMENT = {
  name: "Cloud Security Engineer — S3 & IAM Hardening",
  role: "Cloud Security Engineer",
  seniority: "Mid-level (2–5 yrs)",
  labSlug: "s3-misconfiguration-audit",
  createdAt: "2026-07-02",
  timeLimitMin: 60,
  invited: 6,
  environment: "Real AWS account — isolated per candidate, auto-wiped",
};

// The six checks the live S3 grader actually runs (engine/graders.mjs gradeS3),
// grouped into the four competencies the report scores. Building the sample from
// the real checks keeps it honest — prospects see the exact shape of a real report.
const S3_CHECKS: { dimension: string; description: string }[] = [
  { dimension: "correctness", description: "Public read access blocked on all data buckets" },
  { dimension: "rigor", description: "Over-broad s3:* on the auditor IAM user scoped to least privilege" },
  { dimension: "rigor", description: "Server-side encryption enforced (unencrypted uploads denied)" },
  { dimension: "rigor", description: "TLS required — non-HTTPS requests denied by bucket policy" },
  { dimension: "no_new_exposure", description: "No bucket policy grants a wildcard (anonymous) principal" },
  { dimension: "operational_safety", description: "Buckets secured in place — not deleted to clear the finding" },
];
// A pass/fail pattern (one bool per S3_CHECKS entry) → tagged criteria. Each demo
// candidate's pattern tells a realistic story the competencies make legible.
const mkCriteria = (flags: boolean[]) =>
  S3_CHECKS.map((c, i) => ({ ...c, passed: !!flags[i] }));

const CANDIDATES: DemoCandidate[] = [
  // Clean sweep — secured everything, in place.
  { name: "Priya S.", role: ASSESSMENT.role, passedCount: 6, totalCriteria: 6, timeUsedMin: 41, hasReflection: true, detailAnchor: "#candidate-report", criteria: mkCriteria([true, true, true, true, true, true]) },
  // Solid — missed only TLS enforcement.
  { name: "Ananya K.", role: ASSESSMENT.role, passedCount: 5, totalCriteria: 6, timeUsedMin: 52, hasReflection: true, criteria: mkCriteria([true, true, true, false, true, true]) },
  // Fixed the symptom but left a wildcard grant — the "no new exposure" gap.
  { name: "Rahul M.", role: ASSESSMENT.role, passedCount: 4, totalCriteria: 6, timeUsedMin: 58, hasReflection: true, criteria: mkCriteria([true, true, true, false, false, true]) },
  // Deleted a bucket to clear the finding — correctness AND operational-safety fail.
  { name: "Vikram T.", role: ASSESSMENT.role, passedCount: 2, totalCriteria: 6, timeUsedMin: 60, hasReflection: false, criteria: mkCriteria([false, true, true, false, false, false]) },
];

// One expanded candidate detail (what /r/c/[token] shows) — Priya's clean sweep.
const DETAIL_CRITERIA = mkCriteria([true, true, true, true, true, true]);

const DETAIL_REFLECTION =
  "The data bucket was public and unencrypted, and the pipeline user had s3:* on all resources. " +
  "I blocked public access at the account and bucket level, enforced SSE-KMS, and added a TLS-only " +
  "bucket policy. For IAM, I replaced the wildcard with the five actions the pipeline actually uses, " +
  "scoped to the bucket ARN, and detached the admin policy so a leaked key can't escalate.";

// Same target as the marketing homepage's "Book a walkthrough" CTA — the
// lead-capture form, not a mailto.
const CONTACT_WALKTHROUGH = "/book-demo";

function SampleRibbon() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand/20 bg-brand/[0.06] px-4 py-3.5 text-sm text-brand-strong sm:px-5">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand/10 text-brand ring-1 ring-inset ring-brand/20">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <path d="M8 2.5l6 11H2l6-11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
        </svg>
      </span>
      <p>
        <span className="font-semibold">Sample report.</span> Every candidate and score below is
        fictional, shown to illustrate what employers receive. Real reports are private,
        per-assessment secret links. Want to feel where these scores come from?{" "}
        <Link href="/demo/try" className="font-semibold underline underline-offset-2 hover:text-brand">
          Try the assessment yourself
        </Link>
        .
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
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
  const sortedTimes = rows.map(({ c }) => c.timeUsedMin).sort((a, b) => a - b);
  const medianTime = sortedTimes.length
    ? sortedTimes.length % 2
      ? sortedTimes[(sortedTimes.length - 1) / 2]
      : Math.round((sortedTimes[sortedTimes.length / 2 - 1] + sortedTimes[sortedTimes.length / 2]) / 2)
    : 0;

  const top = rows[0];
  const pcts = rows.map(({ pct }) => pct);
  const minPct = pcts.length ? Math.min(...pcts) : 0;
  const maxPct = pcts.length ? Math.max(...pcts) : 0;
  const fullPass = rows.filter(({ pct }) => pct === 100).length;

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

      {/* Assessment parameters — the context a hiring panel needs to read the
          numbers below cold. */}
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-soft">
        <span><span className="font-semibold text-ink">Role:</span> {ASSESSMENT.role}</span>
        <span><span className="font-semibold text-ink">Level:</span> {ASSESSMENT.seniority}</span>
        <span><span className="font-semibold text-ink">Time limit:</span> {ASSESSMENT.timeLimitMin} min</span>
        <span><span className="font-semibold text-ink">Environment:</span> {ASSESSMENT.environment}</span>
      </div>

      {/* Verdict first: the plain-language takeaway a hiring panel wants before
          the table -- who led and how the field did. Verified facts only
          (objective correctness + timing); never a hire / no-hire call. */}
      <section className="mb-6 overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/[0.07] via-surface to-cyan/[0.04] p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
          At a glance
        </p>
        <p className="mt-2 text-lg font-bold leading-snug text-ink sm:text-xl">
          {top.c.name} leads with {top.c.passedCount} of {top.c.totalCriteria} checks passed,
          in {top.c.timeUsedMin} of {ASSESSMENT.timeLimitMin} min.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          {total} of {ASSESSMENT.invited} invited completed the assessment. Verified scores ranged{" "}
          {minPct}% to {maxPct}% (avg {avgPct}%), and {fullPass} candidate{fullPass === 1 ? "" : "s"}{" "}
          passed every check across all four competencies.
        </p>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Invited" value={String(ASSESSMENT.invited)} />
        <StatCard label="Submitted" value={`${total}/${ASSESSMENT.invited}`} />
        <StatCard label="Avg correctness" value={`${avgPct}%`} />
        <StatCard label="Median time" value={`${medianTime} min`} />
        <StatCard label="With reflection" value={`${withReflection}/${total}`} />
      </div>

      <div className="mb-8">
        <PreliminaryBanner />
      </div>

      <DemoComparisonTable candidates={CANDIDATES} />

      <p className="mt-6 text-xs leading-relaxed text-muted">
        Candidates are ranked by verified performance on a real, isolated AWS environment — not a
        quiz. On a live report, every row links to that candidate&apos;s full private breakdown —
        the first one is expanded below.
      </p>

      {/* ── Candidate detail (what /r/c/[token] shows) ── */}
      <div className="my-12 flex items-center gap-4">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          Inside a candidate&apos;s report
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div id="candidate-report" className="mx-auto max-w-3xl scroll-mt-24">
        <ReportHeader
          as="h2"
          eyebrow="Candidate report"
          title="Priya S."
          meta={
            <span>
              {ASSESSMENT.role} · Completed in 41 of {ASSESSMENT.timeLimitMin} min · Graded {formatDate(ASSESSMENT.createdAt)}
            </span>
          }
        />

        <section className="mb-8 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line bg-gradient-to-br from-brand/[0.05] to-cyan/[0.03] px-6 py-6 sm:px-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
              Verified checks passed
            </h2>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold tabular-nums leading-none text-ink">{detailPassed}</span>
                <span className="text-2xl font-semibold tabular-nums text-muted">/ {DETAIL_CRITERIA.length}</span>
                <span className="ml-1 text-sm text-ink-soft">checks passed</span>
              </div>
              <span className="text-2xl font-bold tabular-nums text-brand">{detailPct}%</span>
            </div>
            <div className="mt-5">
              <Bar pct={detailPct} />
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Competency profile</h2>
            <span className="font-mono text-xs text-muted">
              {detailPassed}/{DETAIL_CRITERIA.length} checks passed
            </span>
          </div>
          <CompetencyProfile criteria={DETAIL_CRITERIA} />
        </section>

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">Written reflection</h2>
          <p className="mb-3 text-xs leading-relaxed text-muted">
            The candidate&apos;s own 3–5 sentence account of what they found and how they fixed it —
            proof they understood the problem, not just clicked through it.
          </p>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-7">
            <blockquote className="relative pl-5 text-ink-soft italic">
              <span
                className="absolute left-0 top-0 h-full w-1 rounded-full bg-gradient-to-b from-brand to-cyan"
                aria-hidden="true"
              />
              {DETAIL_REFLECTION}
            </blockquote>
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
            <WalkthroughCta href={CONTACT_WALKTHROUGH} label="Book a walkthrough" />
          </div>
        </div>
      </div>
    </ReportShell>
  );
}
