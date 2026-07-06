// Shared bits for the employer-facing report pages (app/r/[token] comparison
// view and app/r/c/[token] candidate detail view). Kept intentionally small —
// no client state, plain server-renderable markup, matches the light
// ShieldSync Enterprise theme (see app/globals.css: bg-brand, text-ink, etc).

/** A thin horizontal percentage bar, 0-100. Clamped defensively. */
export function Bar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
      <div
        className="h-full rounded-full bg-brand transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Pass / fail / unknown badge for a single grading criterion. */
export function PassBadge({ passed, unknown }: { passed?: boolean; unknown?: boolean }) {
  if (unknown) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        {"⚠"} Could not verify
      </span>
    );
  }
  if (passed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        {"✓"} Passed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
      {"✗"} Failed
    </span>
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
    <div className="rounded-xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-ink-soft">
      <span className="font-semibold text-brand-strong">Preliminary scoring.</span>{" "}
      Objective correctness is verified now; quality, speed, process, reflection, and integrity
      signals are being finalized and will appear here shortly.
    </div>
  );
}

/** Small "Finalizing" pill used for the still-pending scoring dimensions. */
export function FinalizingPill() {
  return (
    <span className="inline-flex items-center rounded-full bg-line px-2.5 py-0.5 text-xs font-medium text-muted">
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
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">Report not found</h1>
      <p className="mt-3 text-ink-soft">{copy}</p>
    </div>
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
