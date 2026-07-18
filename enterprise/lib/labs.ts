// Single source of truth for the enterprise lab allowlist + display labels.
//
// Imported by BOTH the employer-facing new-assessment form
// (app/portal/assessments/new/new-assessment-form.tsx, a "use client"
// component) AND the server-side create/guard routes
// (app/api/portal/assessments/route.ts) so the two can never drift -- the
// 6-agent map flagged the old dual-source (LAB_OPTIONS in the form vs
// ALLOWED_LAB_SLUGS in the route) as a latent inconsistency.
//
// PURE DATA ONLY (no server imports) so it is safe to pull into the client
// form bundle. Only labs that are actually DEPLOYABLE + GRADEABLE for
// enterprise belong here: adding a slug the engine cannot deploy would just
// burn a lease and grade to 0. Keep in lockstep with the labs/ templates and
// whatever labSlugs the engine recognizes for /ent/assessments.

// slug -> employer-facing label. This map is the ONE place a lab is declared;
// the allowlist and the form options below are both derived from it.
export const LAB_LABEL: Record<string, string> = {
  "s3-misconfiguration-audit": "S3 misconfiguration & data exposure",
  "storage-public-exposure-audit": "Azure Storage public exposure & data leak",
};

// Ordered allowlist of enterprise lab slugs an assessment may be created
// against. Derived from LAB_LABEL so a single edit (add a label) extends both
// the server guard and the form <select>.
export const ENT_LAB_SLUGS: string[] = Object.keys(LAB_LABEL);

// Set form for O(1) server-side membership checks (see isAllowedLabSlug).
const ENT_LAB_SLUG_SET = new Set(ENT_LAB_SLUGS);

export type LabOption = { slug: string; label: string };

// Options for the form <select>, in ENT_LAB_SLUGS order.
export const LAB_OPTIONS: LabOption[] = ENT_LAB_SLUGS.map((slug) => ({
  slug,
  label: LAB_LABEL[slug] ?? slug,
}));

// Authoritative server-side guard: is this an allowlisted, deployable slug?
export function isAllowedLabSlug(slug: string | undefined | null): boolean {
  return typeof slug === "string" && ENT_LAB_SLUG_SET.has(slug);
}

// Display helper -- falls back to the raw slug so an older assessment whose
// lab was retired still renders something sensible.
export function labLabel(slug: string | undefined | null): string {
  if (!slug) return "";
  return LAB_LABEL[slug] ?? slug;
}

// --- Portal v2 module catalog (ADDITIVE; dormant until v2 consumes it) --------
// A "module" is the reusable, independently-graded unit of a COMPOSED assessment
// (Portal v2). See docs/ENTERPRISE-PORTAL-V2-SPEC.md. A module maps 1:1 onto the
// engine's existing lease->deploy->grade->teardown unit (labSlug); v2 only
// orchestrates + aggregates many of them. Only DEPLOYED, GRADEABLE labs get a
// live entry here (adding a non-deployable slug would just burn a lease); the
// planned library lives in the spec, not here, until each lab is buildable.
export type Track = "aws" | "azure" | "soc" | "ai";
export type GraderType = "state" | "investigation" | "attack-then-defend";
export type Module = {
  moduleId: string;
  labSlug: string; // engine target -- MUST be a key of LAB_LABEL
  track: Track;
  domain: string; // "data-protection" | "identity" | "detection" | "incident-response" | "prevention" | "prioritization"
  level: number; // 1..5 the scenario is authored for
  title: string; // recruiter/candidate-facing
  graderType: GraderType;
  minutes: number;
};

// The ONE live module today. Grows as labs are authored (spec Phase 5, the long pole).
export const MODULE_CATALOG: Module[] = [
  {
    moduleId: "aws-s3-exposure-l2",
    labSlug: "s3-misconfiguration-audit",
    track: "aws",
    domain: "data-protection",
    level: 2,
    title: "Lock the exposed S3 store — app preserved",
    graderType: "state",
    minutes: 20,
  },
  {
    // Azure peer of the S3 data-exposure module. Engine target
    // storage-public-exposure-audit carries track:"azure" in its lab.json, so the
    // enterprise engine routes its lease/deploy/grade/teardown to azure-infra.mjs.
    moduleId: "azure-storage-exposure-l1",
    labSlug: "storage-public-exposure-audit",
    track: "azure",
    domain: "data-protection",
    level: 1,
    title: "Lock the leaky Azure Storage account",
    graderType: "state",
    minutes: 30,
  },
];

export function modulesForTrack(track: Track): Module[] {
  return MODULE_CATALOG.filter((m) => m.track === track);
}
export function moduleById(id: string): Module | undefined {
  return MODULE_CATALOG.find((m) => m.moduleId === id);
}
