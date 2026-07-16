import type { LabLevel } from "@/lib/labs";

// Per-level lab access rules — SINGLE SOURCE for the app side.
// The ENGINE mirrors these in engine/labinfra.mjs (LEVEL_RULES / FREE_RULE) — keep in sync.
//  - sessionMinutes: how long ONE live lab run lasts before auto-teardown.
//  - maxLaunches / windowHours: how many runs a user gets in a rolling window.
export type AccessRule = { sessionMinutes: number; maxLaunches: number; windowHours: number };

// Paid labs: 3 launches within a 7-day (168h) window (owner 2026-07-14) — windowHours
// matches the PAY_PER_LAB 7-day entitlement window. sessionMinutes stays per-level.
export const ACCESS_RULES: Record<LabLevel, AccessRule> = {
  Beginner: { sessionMinutes: 30, maxLaunches: 3, windowHours: 168 },
  // sessionMinutes MUST be >= the lab's estimatedActiveMinutes or learners get torn
  // down mid-task. The IAM lab (Intermediate) is ~75 min → 90 gives a buffer.
  Intermediate: { sessionMinutes: 90, maxLaunches: 3, windowHours: 168 },
  Advanced: { sessionMinutes: 120, maxLaunches: 3, windowHours: 168 },
};

// The FREE lab is a lead magnet: TWO runs per user every 24h (temporarily bumped from 1).
// Pre-launch we favour a great first try (a 30-min beginner lab is easy to run out of);
// tighten later via FREE_POOL_PCT once paid is live. KEEP IN SYNC with engine FREE_RULE + marketing FREE_LAUNCH_RULE.
export const FREE_RULE: AccessRule = { sessionMinutes: 30, maxLaunches: 2, windowHours: 24 };

// Monthly subscription = all-access for this many days.
export const MONTHLY_ACCESS_DAYS = 30;

// Rules for a lab: free labs use FREE_RULE, otherwise the level's rule.
export function rulesForLab(level: LabLevel, free: boolean): AccessRule {
  return free ? FREE_RULE : ACCESS_RULES[level];
}

// Human-readable, e.g. "3 launches over a 7-day window · 30 min each" / "2 launches over a 24h window · 30 min each".
export function rulesSummary(level: LabLevel, free: boolean): string {
  const r = rulesForLab(level, free);
  const dur = r.sessionMinutes >= 60 ? `${r.sessionMinutes / 60} h` : `${r.sessionMinutes} min`;
  const runs = `${r.maxLaunches} launch${r.maxLaunches === 1 ? "" : "es"}`;
  const win = r.windowHours % 24 === 0 && r.windowHours >= 48 ? `${r.windowHours / 24}-day` : `${r.windowHours}h`;
  return `${runs} over a ${win} window · ${dur} each`;
}
