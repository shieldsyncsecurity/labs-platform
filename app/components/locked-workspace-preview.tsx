"use client";

import Link from "next/link";

/**
 * Signed-out state for the guide column (design "E", layered on the C+J shell):
 * a blurred, non-interactive mock of the REAL workspace — step rail, step card,
 * session panel with live objective ticks — behind a centered unlock card.
 * "Here's what you unlock", instead of a bare sign-in button.
 *
 * The readable overview still renders ABOVE this (so crawlers and undecided
 * visitors get the actual scenario prose); only the walkthrough half is teased.
 * The mock is decorative: aria-hidden, pointer-events-none, unselectable — the
 * accessible content is the overlay card alone. Step titles are the lab's REAL
 * ones; the session timer / tick counts are illustrative UI, like a screenshot.
 */
export function LockedWorkspacePreview({
  steps,
  slug,
  free,
}: {
  steps: string[];
  slug: string;
  free: boolean;
}) {
  const shown = steps.length > 0 ? steps.slice(0, 5) : ["Meet the environment", "Find the flaw", "Apply the fix", "Verify"];
  const line = "h-2 rounded bg-line";

  return (
    <div className="not-prose relative mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
      {/* ── decorative workspace mock ─────────────────────────────────────── */}
      <div
        aria-hidden
        className="pointer-events-none select-none p-4 sm:p-5"
        style={{ filter: "blur(3.5px)", opacity: 0.45 }}
      >
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 sm:grid-cols-[130px_minmax(0,1fr)_150px]">
          {/* step rail */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold tracking-widest text-muted">STEPS</p>
            {shown.map((s, i) => (
              <div
                key={i}
                className={`truncate rounded-lg px-2 py-1.5 text-[11px] ${
                  i === 2 ? "bg-brand/10 font-semibold text-brand" : i < 2 ? "text-emerald-700" : "text-muted"
                }`}
              >
                {i < 2 ? "✓ " : ""}
                {i + 1}. {s}
              </div>
            ))}
          </div>

          {/* step card */}
          <div className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line bg-canvas px-3 py-2">
              <span className="truncate text-[11px] font-semibold text-ink">{shown[2] ?? shown[0]}</span>
              <span className="flex-none rounded-md border border-line bg-surface px-1.5 py-0.5 text-[9px] font-bold text-muted">
                🖱️ / ⌨️
              </span>
            </div>
            <div className="space-y-2 p-3">
              <div className={`${line} w-full`} />
              <div className={`${line} w-11/12`} />
              <div className="rounded-lg border border-line bg-canvas p-2">
                <div className="h-1.5 w-4/5 rounded bg-line-strong" />
                <div className="mt-1.5 h-1.5 w-3/5 rounded bg-line-strong" />
              </div>
              <div className={`${line} w-10/12`} />
              <div className={`${line} w-2/3`} />
            </div>
            <div className="flex items-center justify-between border-t border-line px-3 py-2">
              <span className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-muted">← Back</span>
              <span className="rounded-md bg-brand px-2 py-1 text-[10px] font-semibold text-white">Next →</span>
            </div>
          </div>

          {/* session panel */}
          <div className="hidden space-y-2 rounded-xl border border-line p-3 sm:block">
            <p className="text-[11px] font-bold text-ink">Session · 27:14</p>
            <div className="rounded-md bg-brand px-2 py-1.5 text-center text-[10px] font-bold text-white">
              Open AWS console ↗
            </div>
            <div className="space-y-1.5 pt-1">
              {[true, true, false, false].map((done, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className={`h-3 w-3 flex-none rounded ${done ? "bg-emerald-500" : "border-2 border-line-strong"}`}
                  />
                  <span className={`h-1.5 flex-1 rounded ${done ? "bg-emerald-200" : "bg-line"}`} />
                </div>
              ))}
            </div>
            <div className="rounded-md bg-gradient-to-r from-brand to-cyan px-2 py-1.5 text-center text-[10px] font-bold text-white">
              Check my work
            </div>
          </div>
        </div>
      </div>

      {/* ── unlock card ───────────────────────────────────────────────────── */}
      <div className="absolute inset-0 flex items-center justify-center bg-surface/55 p-4 backdrop-blur-[1px]">
        <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 text-center shadow-lg">
          <span
            aria-hidden
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-cyan text-white"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <p className="mt-3 text-base font-extrabold text-ink">This is your workspace</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-ink-soft">
            Sign in and a real, isolated AWS account spins up — the step-by-step guide opens here, graded
            against your live fixes.
          </p>
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(`/labs/${slug}`)}`}
            className="mt-4 block rounded-xl bg-gradient-to-r from-brand to-cyan px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/20 transition hover:brightness-110"
          >
            {free ? "Sign in & launch — free" : "Sign in to start"}
          </Link>
          <p className="mt-2 text-xs text-muted">
            {free ? "No card needed · auto-wiped when you're done" : "Auto-wiped when you're done"}
          </p>
        </div>
      </div>
    </div>
  );
}
