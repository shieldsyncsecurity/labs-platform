// Shared bits for the employer-facing report pages (app/r/[token] comparison
// view and app/r/c/[token] candidate detail view) and the public /demo/report
// sample. Server-renderable markup only (no client state), matching the light
// ShieldSync Enterprise theme (see app/globals.css: bg-brand, text-ink, etc).
//
// VISUAL layer only — the exported names + prop signatures below are a hard
// contract the report pages depend on; do not change them. The honest-MVP
// scoring rules also live here (correctnessPct + the Preliminary/Finalizing
// language) and must stay: only objective correctness is real today.

import Link from "next/link";
import { Logo } from "@/components/brand";
import { SiteFooter } from "@/components/marketing/site-footer";

/**
 * Page frame shared by every report surface: a slim top bar with the ShieldSync
 * Enterprise logo, the report body, and the standard marketing footer — so a
 * bare report link reads like a real product page. Decorative chrome only; all
 * data lives in `children`.
 */
export function ReportShell({
  children,
  ribbon,
}: {
  children: React.ReactNode;
  ribbon?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-6 lg:px-8">
          <Logo href="/" />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs font-medium text-muted sm:inline-flex">
              <LockGlyph className="h-3.5 w-3.5 text-brand" />
              Private report
            </span>
            <Link
              href="/"
              className="hidden rounded text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:inline"
            >
              Enterprise home
            </Link>
          </div>
        </div>
      </header>

      {ribbon ? (
        <div className="mx-auto w-full max-w-5xl px-5 pt-6 sm:px-6 lg:px-8">{ribbon}</div>
      ) : null}

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-6 sm:py-14 lg:px-8">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}

/** Small lock glyph for the "private report" affordance. Decorative. */
function LockGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" opacity="0.9" />
      <path
        d="M5 7V5.2a3 3 0 0 1 6 0V7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Report header used across the comparison + candidate surfaces: an eyebrow,
 * a title, and an optional meta line (lab slug / dates). Pure presentation.
 */
export function ReportHeader({
  eyebrow,
  title,
  meta,
  as: Heading = "h1",
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  // Semantic level for the title. Defaults to "h1"; pass "h2" when a page
  // already has an h1 (e.g. the sample report renders a second header inline).
  // Visual size is unchanged regardless of level.
  as?: "h1" | "h2";
}) {
  return (
    <header className="mb-8">
      {eyebrow ? (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
          {eyebrow}
        </p>
      ) : null}
      <Heading className="text-2xl font-bold tracking-tight text-ink sm:text-[2rem] sm:leading-[1.15]">
        {title}
      </Heading>
      {meta ? <div className="mt-2 text-sm text-muted">{meta}</div> : null}
    </header>
  );
}

/**
 * A thin horizontal percentage bar, 0-100. Clamped defensively. Rounded track
 * with a brand amber gradient fill.
 */
export function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line-strong/60"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand to-cyan shadow-[0_1px_2px_rgba(217,119,6,0.35)] transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Pass / fail / unknown badge for a single grading criterion. */
export function PassBadge({ passed, unknown }: { passed?: boolean; unknown?: boolean }) {
  if (unknown) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
        <GlyphWarn className="h-3.5 w-3.5" />
        Could not verify
      </span>
    );
  }
  if (passed) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <GlyphCheck className="h-3.5 w-3.5" />
        Passed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
      <GlyphCross className="h-3.5 w-3.5" />
      Failed
    </span>
  );
}

function GlyphCheck({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function GlyphCross({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5l7 7m0-7l-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function GlyphWarn({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M8 2.5l6 11H2l6-11z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

/**
 * The honest-MVP-scoring disclosure banner. Every report page must show this
 * near the top — right now only objective "correctness" is computed
 * (criteria pass/fail), so we never render a composite /100 score or a
 * hire-signal verdict. The copy states plainly what is scored today and makes
 * no promise about dimensions that are not yet computed.
 */
export function PreliminaryBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-cyan/[0.04] px-4 py-3.5 text-sm text-ink-soft sm:px-5">
      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand/10 text-brand">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 5v3.2l2 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <p>
        <span className="font-semibold text-brand-strong">How this is scored.</span>{" "}
        Every check below is verified against the live cloud environment each candidate worked in.
        Scoring reflects objective, measured outcomes only — we don&rsquo;t infer soft skills or
        apply a hire / no-hire verdict.
      </p>
    </div>
  );
}

/** Small "Finalizing" pill used for the still-pending scoring dimensions. */
export function FinalizingPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-inset ring-line-strong/60">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-line-strong" aria-hidden="true" />
      Finalizing
    </span>
  );
}

/** Consistent "report not found" state for both report routes. */
export function ReportNotFound({ context }: { context: "assessment" | "candidate" }) {
  const copy =
    context === "assessment"
      ? "This report link is invalid or has expired. Double-check the link, or ask your ShieldSync contact to resend it."
      : "This candidate report link is invalid or has expired. Double-check the link, or ask your ShieldSync contact to resend it.";
  return (
    <ReportShell>
      <div className="mx-auto max-w-lg px-2 py-16 text-center sm:py-24">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/5 ring-1 ring-inset ring-brand/15">
          <LockGlyph className="h-6 w-6 text-brand" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Report not found</h1>
        <p className="mt-3 text-ink-soft">{copy}</p>
        <a
          href="https://shieldsyncsecurity.com"
          className="mt-6 inline-flex items-center rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand/40 hover:text-ink"
        >
          Go to shieldsyncsecurity.com
        </a>
      </div>
    </ReportShell>
  );
}

/** Safe correctness percentage from passedCount/totalCriteria, defaults to 0. */
export function correctnessPct(passedCount?: number, totalCriteria?: number): number {
  const total = totalCriteria ?? 0;
  const passed = passedCount ?? 0;
  if (!total) return 0;
  return Math.round((100 * passed) / total);
}

/**
 * Honest pass/total from a criteria list: "could not verify" (unknown) checks are
 * EXCLUDED from both numerator and denominator, so an unverifiable check never reads
 * as a failure and an all-unknown run is `total: 0` (render "Not verified", never "0%").
 * This mirrors groupByDimension's per-dimension `verified` count, so the headline and
 * the per-competency pills always agree. Falls back to the stored counts only when no
 * criteria detail is present (older results); the stored passedCount already excludes
 * unknowns from its numerator, but the stored totalCriteria does not — hence prefer criteria.
 */
export function verifiedStats(
  criteria: ReportCriterion[] | undefined,
  fallbackPassed?: number,
  fallbackTotal?: number,
): { passed: number; total: number; hadUnknown: boolean } {
  if (Array.isArray(criteria) && criteria.length > 0) {
    const verified = criteria.filter((c) => !c?.unknown);
    return {
      passed: verified.filter((c) => c?.passed).length,
      total: verified.length,
      hadUnknown: verified.length < criteria.length,
    };
  }
  return { passed: fallbackPassed ?? 0, total: fallbackTotal ?? 0, hadUnknown: false };
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * A tasteful, medal-free rank indicator: #1 gets a subtle brand emphasis,
 * everyone else a muted mono numeral. Presentation only.
 */
export function RankBadge({ rank }: { rank: number }) {
  const isTop = rank === 1;
  return (
    <>
      <span className="sr-only">Rank {rank}</span>
      <span
        className={
          isTop
            ? "inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand text-xs font-bold text-white shadow-sm"
            : "inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-canvas font-mono text-xs font-semibold text-muted ring-1 ring-inset ring-line-strong/60"
        }
        aria-hidden="true"
      >
        {rank}
      </span>
    </>
  );
}

// ── Competency profile ───────────────────────────────────────────────────────
// The report decomposes the single "correctness" number into the competencies a
// hiring manager actually weighs. Every dimension here is OBJECTIVE and evidence-
// backed: each criterion is verified against the live cloud environment the
// candidate worked in (see engine/graders*.mjs). This introduces NO un-measured
// signal — it does not touch the still-"pending" soft dimensions (quality/speed/
// process/reflection) — so it stays inside the honest-scoring rule at the top of
// this file: only what we can verify is shown, and there is still no /100 or
// hire/no-hire verdict.

export type ReportCriterion = {
  id?: string;
  description?: string;
  passed?: boolean;
  unknown?: boolean;
  dimension?: string;
};

// Display order + hiring-manager-facing label & meaning for each graded dimension.
// Keys must match the `dimension` tags authored in engine/graders*.mjs.
const DIMENSION_META: { key: string; label: string; blurb: string }[] = [
  { key: "correctness", label: "Objective correctness", blurb: "Reached the required secure end-state — the core task." },
  { key: "rigor", label: "Security rigor", blurb: "Hardened properly: least privilege and defence in depth, not just the minimum." },
  { key: "no_new_exposure", label: "No new exposure", blurb: "Closed the issue without leaving or opening another way in." },
  { key: "operational_safety", label: "Operational safety", blurb: "Secured the workload in place — didn't delete or break it to clear the alert." },
];
// Any criterion without a recognised dimension (older results, or a lab not yet
// tagged) still renders, grouped under a neutral bucket at the end.
const FALLBACK_DIM = { key: "objectives", label: "Objectives", blurb: "Verified checks for this assessment." };

export type CompetencyGroup = {
  key: string;
  label: string;
  blurb: string;
  criteria: ReportCriterion[];
  passed: number; // verified-passing
  verified: number; // total minus "could not verify"
  total: number;
};

/** Group graded criteria into ordered competency buckets by their `dimension` tag. */
export function groupByDimension(criteria: ReportCriterion[]): CompetencyGroup[] {
  const known = new Set(DIMENSION_META.map((d) => d.key));
  const byKey = new Map<string, ReportCriterion[]>();
  for (const c of criteria) {
    const k = c?.dimension && known.has(c.dimension) ? c.dimension : FALLBACK_DIM.key;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(c);
  }
  const groups: CompetencyGroup[] = [];
  for (const meta of [...DIMENSION_META, FALLBACK_DIM]) {
    const list = byKey.get(meta.key);
    if (!list || list.length === 0) continue;
    const verified = list.filter((c) => !c.unknown).length;
    const passed = list.filter((c) => c.passed && !c.unknown).length;
    groups.push({ ...meta, criteria: list, passed, verified, total: list.length });
  }
  return groups;
}

/**
 * The competency profile: one scorecard per assessed dimension, each showing its
 * verified pass ratio and the individual checks (evidence) behind it. This is the
 * report's core — a Big-4-style breakdown grounded entirely in live-environment
 * checks. Renders nothing if there are no criteria.
 */
export function CompetencyProfile({ criteria }: { criteria: ReportCriterion[] }) {
  const groups = groupByDimension(criteria);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const allUnknown = g.verified === 0;
        const pct = g.verified ? Math.round((100 * g.passed) / g.verified) : 0;
        return (
          <section
            key={g.key}
            className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-line/70 bg-canvas/40 px-5 py-4 sm:px-6">
              <div className="min-w-0 max-w-md">
                <h3 className="text-sm font-semibold text-ink">{g.label}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{g.blurb}</p>
              </div>
              {allUnknown ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                  <GlyphWarn className="h-3.5 w-3.5" />
                  Not verified
                </span>
              ) : (
                <div className="flex flex-none items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {g.passed}/{g.verified}
                  </span>
                  <div className="w-24 sm:w-28">
                    <Bar pct={pct} />
                  </div>
                </div>
              )}
            </div>
            <ul>
              {g.criteria.map((c, i) => (
                <li
                  key={c?.id ?? i}
                  className="flex items-center justify-between gap-4 border-b border-line/60 px-5 py-3 last:border-b-0 hover:bg-canvas/50 sm:px-6"
                >
                  <span className="text-sm text-ink-soft">
                    {c?.description ?? c?.id ?? `Check ${i + 1}`}
                  </span>
                  <span className="flex-none">
                    <PassBadge passed={c?.passed} unknown={c?.unknown} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Compact competency summary for the comparison table — one small pass/total pill
 * per assessed dimension, so an employer can scan competencies across candidates
 * at a glance. Skips the neutral fallback bucket to keep the row tight.
 */
export function CompetencyChips({
  criteria,
  className = "",
}: {
  criteria: ReportCriterion[];
  className?: string;
}) {
  const groups = groupByDimension(criteria).filter((g) => g.key !== FALLBACK_DIM.key);
  // Returns null (renders nothing) when there are no tagged competencies — so callers
  // apply spacing via `className` here rather than an outer wrapper, which would leave an
  // empty margin box for all-untagged (older) results.
  if (groups.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {groups.map((g) => {
        const allUnknown = g.verified === 0;
        const perfect = !allUnknown && g.passed === g.verified;
        const tone = allUnknown
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : perfect
            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
            : "bg-rose-50 text-rose-700 ring-rose-200";
        return (
          <span
            key={g.key}
            title={g.label}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}
          >
            {g.label}
            <span className="font-mono tabular-nums">{allUnknown ? "—" : `${g.passed}/${g.verified}`}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Shared "Book a walkthrough" CTA link, brand pill. */
export function WalkthroughCta({
  href = "https://shieldsyncsecurity.com",
  label = "Book a walkthrough",
  internal = false,
}: {
  href?: string;
  label?: string;
  internal?: boolean;
}) {
  const cls =
    "inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  if (internal) {
    return (
      <Link href={href} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <a href={href} className={cls}>
      {label}
    </a>
  );
}
