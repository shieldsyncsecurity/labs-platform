"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useLabWorkspace } from "@/components/lab-workspace";
import { MissionHud } from "@/components/mission-hud";

type Objective = { id: string; description: string };

const chip = "rounded-md border px-2 py-0.5 text-xs font-bold";

/**
 * State-aware shell for the lab page (design C + J, owner 2026-07-16).
 *
 * PRE-LAUNCH — a lab LANDING page: full title + summary visible immediately
 * (no hidden disclosure, no gradient breadcrumb band), natural page scroll,
 * content-sized sticky launch card. This is what ad traffic decides on.
 *
 * LAUNCHED — the split WORKSPACE: header collapses to one slim row, the
 * Mission HUD pins the live objectives + Check my work above the grid, and the
 * grid locks to the viewport (guide + panel scroll internally) as before.
 */
export function LabShell({
  title,
  summary,
  level,
  free,
  minutes,
  policy,
  objectives,
  statusSlot,
  guideSlot,
  panelSlot,
}: {
  title: string;
  summary: string;
  level: string;
  free: boolean;
  minutes: number;
  policy: string;
  objectives: Objective[];
  statusSlot: ReactNode;
  guideSlot: ReactNode;
  panelSlot: ReactNode;
}) {
  const { launched } = useLabWorkspace();

  const badges = (
    <span className="flex flex-none flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`${chip} border-brand/25 bg-brand/10 text-brand`}>{level}</span>
      {free && <span className={`${chip} border-emerald-300 bg-emerald-50 text-emerald-700`}>FREE</span>}
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
        ~{minutes} min
      </span>
    </span>
  );

  return (
    <>
      {launched ? (
        /* Slim one-row header: every vertical pixel above the workspace is
           budgeted in --ss-chrome-h (globals.css) — keep this row cheap. */
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line pb-2.5 text-sm">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href="/" className="flex-none font-semibold text-muted hover:text-ink">Labs</Link>
            <span aria-hidden className="flex-none text-line-strong">›</span>
            <span className="min-w-0 truncate font-bold text-ink" title={title}>{title}</span>
          </div>
          {badges}
        </div>
      ) : (
        /* Landing header: the page says what the lab IS, immediately. */
        <header>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm">
            <p className="text-muted">
              <Link href="/" className="font-semibold hover:text-ink">Labs</Link>
              <span aria-hidden className="mx-2 text-line-strong">›</span>
              <span className="text-ink-soft">{title}</span>
            </p>
            <a href="https://shieldsyncsecurity.com/labs-wizard" className="text-xs font-medium text-muted hover:text-ink">
              ← Back to plans
            </a>
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 max-w-3xl text-base leading-7 text-ink-soft">{summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {badges}
            {policy && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2 py-0.5 text-xs font-semibold text-muted">
                <span aria-hidden>↻</span> {policy}
              </span>
            )}
          </div>
        </header>
      )}

      {statusSlot}
      <MissionHud objectives={objectives} />

      <div
        className={`mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:gap-8 ${
          launched ? "lg:h-[var(--ss-workspace-h)] lg:min-h-0" : ""
        }`}
      >
        <div className="min-w-0 lg:min-h-0">{guideSlot}</div>
        <div className="min-w-0 lg:min-h-0">
          <aside
            className={
              launched
                ? "lg:sticky lg:top-[4.5rem] lg:max-h-[var(--ss-workspace-h)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
                : "lg:sticky lg:top-[4.5rem]"
            }
          >
            {panelSlot}
          </aside>
        </div>
      </div>
    </>
  );
}
