import type { LabLevel } from "@/lib/labs";

// Per-level lab access rules — SINGLE SOURCE for the app side.
// The ENGINE mirrors these in engine/labinfra.mjs (LEVEL_RULES / FREE_RULE) — keep in sync.
//  - sessionMinutes: how long ONE live lab run lasts before auto-teardown.
//  - maxLaunches / windowHours: how many runs a user gets in a rolling window.
export type AccessRule = { sessionMinutes: number; maxLaunches: number; windowHours: number };

export const ACCESS_RULES: Record<LabLevel, AccessRule> = {
  Beginner: { sessionMinutes: 30, maxLaunches: 3, windowHours: 72 },
  Intermediate: { sessionMinutes: 60, maxLaunches: 2, windowHours: 48 },
  Advanced: { sessionMinutes: 120, maxLaunches: 2, windowHours: 48 },
};

// The FREE lab is a lead magnet: ONE run per user every 48h (tighter than paid
// Beginner's 3/72h, to nudge conversion). Session length stays Beginner's 30 min.
export const FREE_RULE: AccessRule = { sessionMinutes: 30, maxLaunches: 1, windowHours: 48 };

// Monthly subscription = all-access for this many days.
export const MONTHLY_ACCESS_DAYS = 30;

// Rules for a lab: free labs use FREE_RULE, otherwise the level's rule.
export function rulesForLab(level: LabLevel, free: boolean): AccessRule {
  return free ? FREE_RULE : ACCESS_RULES[level];
}

// Human-readable, e.g. "3 launches over 72h · 30 min each" / "1 launch over 48h · 30 min each".
export function rulesSummary(level: LabLevel, free: boolean): string {
  const r = rulesForLab(level, free);
  const dur = r.sessionMinutes >= 60 ? `${r.sessionMinutes / 60} h` : `${r.sessionMinutes} min`;
  const runs = `${r.maxLaunches} launch${r.maxLaunches === 1 ? "" : "es"}`;
  return `${runs} over ${r.windowHours}h · ${dur} each`;
}
