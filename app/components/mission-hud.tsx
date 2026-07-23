"use client";

import { useLabWorkspace } from "@/components/lab-workspace";

type Objective = { id: string; description: string };

/* Compress a full objective sentence into a chip label: cut at the first
 * sentence/clause break, cap the length. The full description stays available
 * as the chip's title tooltip. */
function shortLabel(description: string): string {
  const cut = description.split(/[—:;.(]/)[0].trim();
  return cut.length > 34 ? `${cut.slice(0, 33).trimEnd()}…` : cut;
}

/**
 * Mission HUD — the objectives-first strip pinned above the workspace while a
 * lab is live. Each objective ticks green as the grader verifies it against the
 * live AWS account; the "Check my work" button triggers the SAME grade the
 * panel owns (registered through the workspace context), so there is exactly
 * one grading pipeline. Renders nothing pre-launch or for labs with no
 * gradable objectives.
 */
export function MissionHud({ objectives }: { objectives: Objective[] }) {
  const { launched, objectiveStatus, gradePassed, checkWork, checking } = useLabWorkspace();
  if (!launched || objectives.length === 0) return null;

  const done = objectives.filter((o) => objectiveStatus[o.id] === "pass").length;

  return (
    <div className="sticky top-16 z-30 mt-3 rounded-xl border border-brand/25 bg-[#eef2ff]/95 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[#eef2ff]/80">
      <div className="flex items-center gap-3">
        <span className="hidden flex-none font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-brand sm:inline">
          Objectives
        </span>
        <ul className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {objectives.map((o) => {
            const pass = objectiveStatus[o.id] === "pass";
            return (
              <li key={o.id} title={o.description} className="flex flex-none items-center gap-1.5 text-[13px] font-semibold">
                {pass ? (
                  <span aria-hidden className="flex h-4 w-4 flex-none items-center justify-center rounded bg-emerald-500 text-white">
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                ) : (
                  <span aria-hidden className="h-4 w-4 flex-none rounded border-2 border-slate-400/80 bg-white" />
                )}
                <span className={pass ? "text-emerald-700" : "text-ink-soft"}>{shortLabel(o.description)}</span>
                <span className="sr-only">{pass ? " — verified" : " — not verified yet"}</span>
              </li>
            );
          })}
        </ul>
        <span className={`hidden flex-none text-xs font-bold tabular-nums md:inline ${gradePassed ? "text-emerald-700" : "text-ink-soft"}`}>
          {done}/{objectives.length} fixed
        </span>
        {checkWork ? (
          <button
            type="button"
            onClick={() => checkWork()}
            disabled={checking}
            className="flex-none rounded-lg bg-gradient-to-r from-brand to-cyan px-3.5 py-1.5 text-[13px] font-bold text-white shadow-sm shadow-brand/20 transition hover:brightness-110 disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check my work"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
