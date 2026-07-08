// The lab catalogue shown in the platform. SINGLE SOURCE OF TRUTH = each lab's
// app/content/labs/<slug>/lab.json — `labCatalog` (lib/lab-catalog.ts) is generated
// from those by scripts/build-lab-content.mjs (run it after editing any lab.json).
// `ready` = a CloudFormation template exists in labs-platform/labs/<slug>/.
import { labCatalog } from "./lab-catalog";
import { applyLabSettings } from "./lab-settings";

export type LabLevel = "Beginner" | "Intermediate" | "Advanced";

export type Lab = {
  slug: string;
  track: "aws" | "azure"; // which cloud this lab runs on (drives launch dispatch)
  title: string;
  level: LabLevel;
  free: boolean;
  ready: boolean; // IaC authored AND the engine can launch this track (false = shown but not launchable)
  summary: string;
  tags: string[];
  estimatedActiveMinutes: number;
};

// Catalog with per-lab settings overrides applied (tags/ready/free come from
// app/lab-settings.json — the /admin/labs panel's data file).
export const LABS: Lab[] = labCatalog.map(applyLabSettings);

export function getLab(slug: string): Lab | undefined {
  return LABS.find((l) => l.slug === slug);
}

export function readyLabs(): Lab[] {
  return LABS.filter((l) => l.ready);
}

// Deterministic "what's next" pick: the next READY lab after the current one in
// catalog order, wrapping around, skipping the current slug. Pure catalog lookup —
// no grading/session/entitlement logic involved. (If it's paid and payments are
// off, we still link to the lab page — its own panel explains "Get this lab" /
// launch soon.) Shared by the panel's done-card upsell and the guide's completion card.
export function nextLab(currentSlug: string): Lab | null {
  const labs = readyLabs();
  if (labs.length <= 1) return null;
  const i = labs.findIndex((l) => l.slug === currentSlug);
  for (let step = 1; step <= labs.length; step++) {
    const candidate = labs[(i + step) % labs.length];
    if (candidate.slug !== currentSlug) return candidate;
  }
  return null;
}
