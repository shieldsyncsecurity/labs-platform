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
            <a
              href="https://shieldsyncsecurity.com"
              className="hidden text-sm font-medium text-muted transition-colors hover:text-ink sm:inline"
            >
              Main site
            </a>
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
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <header className="mb-8">
      {eyebrow ? (
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[2rem] sm:leading-[1.15]">
        {title}
      </h1>
      {meta ? <div className="mt-2 text-sm text-muted">{meta}</div> : null}
    </header>
  );
}

/**
 * A thin horizontal percentage bar, 0-100. Clamped defensively. Rounded track
 * with a soft indigo->blue gradient fill.
 */
export function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-canvas ring-1 ring-inset ring-line-strong/60"
      aria-hidden="true"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand to-cyan shadow-[0_1px_2px_rgba(79,70,229,0.35)] transition-[width] duration-500 ease-out"
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
 * hire-signal verdict. Quality, speed, process, reflection, and integrity
 * are all still "pending" server-side and shown as "Finalizing" here.
 */
export function PreliminaryBanner() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-cyan/[0.04] px-4 py-3.5 text-sm text-ink-soft sm:px-5">
      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand/10 text-brand">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-pulse" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 5v3.2l2 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <p>
        <span className="font-semibold text-brand-strong">Preliminary scoring.</span>{" "}
        Objective correctness is verified now; quality, speed, process, reflection, and integrity
        signals are being finalized and will appear here shortly.
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

export function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * A tasteful, medal-free rank indicator: #1 gets a subtle indigo emphasis,
 * everyone else a muted mono numeral. Presentation only.
 */
export function RankBadge({ rank }: { rank: number }) {
  const isTop = rank === 1;
  return (
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
  );
}

/** Shared "Book a walkthrough" CTA link, indigo pill. */
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
