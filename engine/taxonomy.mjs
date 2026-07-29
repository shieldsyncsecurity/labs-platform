// ShieldSync assessment taxonomy — the CLOUD-AGNOSTIC, VENDOR-AGNOSTIC frame every
// lab grades against, whatever the provider or service.
//
// WHY THIS FILE EXISTS
// Each grader used to invent its own criteria shape, and only two of the four labs
// even tagged a competency. That makes it impossible to say anything true about the
// product as a whole ("we assess a candidate on N parameters") because there was no
// product-wide frame - only per-lab lists. This file is that frame, in code, so the
// claim is computed from what actually ships rather than asserted in a slide.
//
// THE MODEL: every scored check is one cell of DIMENSION x DOMAIN.
//   DIMENSION = how well they did it   (quality of the work)
//   DOMAIN    = what area they did it in (the security surface)
// A check is one verified statement about real infrastructure state. Nothing here
// is provider-specific: the same cell is satisfied by an AWS bucket policy, an Azure
// storage account, or a GCP bucket - which is exactly what makes the frame portable
// to new clouds and new vendors without re-marketing.

/** HOW WELL the candidate did the work. Ordered for display. */
export const DIMENSIONS = [
  {
    key: "correctness",
    label: "Objective correctness",
    blurb: "Reached the required secure end-state - the core task.",
  },
  {
    key: "rigor",
    label: "Security rigor",
    blurb: "Hardened properly: least privilege and defence in depth, not just the minimum.",
  },
  {
    key: "no_new_exposure",
    label: "No new exposure",
    blurb: "Closed the issue without leaving or opening another way in.",
  },
  {
    key: "operational_safety",
    label: "Operational safety",
    blurb: "Secured the workload in place - did not delete or break it to clear the alert.",
  },
];

/** WHAT SURFACE the work touched. Deliberately named in cloud-neutral terms; the
 *  provider equivalents are listed so a new cloud maps in without inventing a
 *  domain. Sourced from the taxonomy in ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md §2. */
export const DOMAINS = [
  {
    key: "identity",
    label: "Identity & access",
    equivalents: "AWS IAM · Microsoft Entra ID / Azure RBAC · GCP IAM",
  },
  {
    key: "data_protection",
    label: "Data protection",
    equivalents: "S3 · Azure Storage · KMS / Key Vault · Secrets Manager",
  },
  {
    key: "network",
    label: "Network exposure",
    equivalents: "Security Groups / NACLs · Azure NSGs · firewall rules",
  },
  {
    key: "detection",
    label: "Logging & detection",
    equivalents: "CloudTrail / Config / GuardDuty · Azure Activity Log / Policy / Defender",
  },
  {
    key: "response",
    label: "Incident response",
    equivalents: "credential containment · isolation · blast-radius control",
  },
  {
    key: "ai_security",
    label: "AI / model security",
    equivalents: "Bedrock Guardrails · Azure OpenAI content filters · prompt-injection defence",
  },
  {
    key: "governance",
    label: "Governance guardrails",
    equivalents: "account-local policy proxies (org/SCP content is deliberately out of scope)",
  },
];

const DIMENSION_KEYS = new Set(DIMENSIONS.map((d) => d.key));
const DOMAIN_KEYS = new Set(DOMAINS.map((d) => d.key));

/** The full assessable frame: how many distinct dimension x domain cells exist.
 *  This is a CAPABILITY statement about the platform, not a per-candidate one -
 *  keep the two apart in any copy. */
export const FRAME_SIZE = DIMENSIONS.length * DOMAINS.length;

/**
 * countParameters(criteria): how many VERIFIED PARAMETERS a given assessment
 * actually measured, plus the frame coverage it touched.
 *
 * Counting rule, chosen so the number can survive a buyer poking at it:
 *  - a criterion WITH sub-checks counts as its sub-check count (each sub-check is
 *    an independently verified statement about a real resource);
 *  - a criterion WITHOUT sub-checks counts as 1;
 *  - criteria that could not be verified are EXCLUDED - we never count a check we
 *    did not actually complete.
 * Advisory evidence (time on task, work timeline, recording, reflection) is
 * deliberately NOT counted here. It is evidence we surface, not a parameter we
 * score, and conflating them would mean marketing a dimension we do not grade.
 */
export function countParameters(criteria) {
  const list = Array.isArray(criteria) ? criteria : [];
  let parameters = 0;
  const dims = new Set();
  const domains = new Set();
  for (const c of list) {
    if (!c || c.unknown) continue;
    parameters += Array.isArray(c.subChecks) && c.subChecks.length > 0 ? c.subChecks.length : 1;
    if (c.dimension && DIMENSION_KEYS.has(c.dimension)) dims.add(c.dimension);
    if (c.domain && DOMAIN_KEYS.has(c.domain)) domains.add(c.domain);
  }
  return {
    parameters,
    criteria: list.filter((c) => c && !c.unknown).length,
    dimensions: [...dims],
    domains: [...domains],
    frameSize: FRAME_SIZE,
  };
}
