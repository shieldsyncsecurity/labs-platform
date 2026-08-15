// ShieldSync assessment taxonomy — the CLOUD-AGNOSTIC, VENDOR-AGNOSTIC frame every
// lab grades against, across all four product tracks.
//
// WHY THIS FILE EXISTS
// Each grader used to invent its own criteria shape, and only two of four labs even
// tagged a competency. That makes it impossible to say anything true about the
// product as a whole ("we assess on N parameters") because there was no product-wide
// frame - only per-lab lists. This file is that frame, in code, so any claim is
// COMPUTED from what actually ships rather than asserted in a slide and left to rot.
//
// THE MODEL: every scored check is one cell of DIMENSION x DOMAIN.
//   DIMENSION = how well they did it    (quality of the work)
//   DOMAIN    = what security surface   (the area of work)
// Nothing here is provider-specific. The same cell is satisfied by an AWS bucket
// policy, an Azure storage account, a Wazuh decoder or a Shuffle playbook - which is
// what lets a new cloud, SIEM or SOAR product map in without re-marketing anything.
//
// HONESTY RULE (load-bearing): `live` on each domain records whether a SHIPPED lab
// actually grades it. The frame size is a statement about the MODEL; live coverage
// is a statement about the PRODUCT. Marketing may quote both, but never conflate
// them - see docs/GRADING-SIGNALS-PLAN.md.

/** HOW WELL the candidate did the work. Applies identically to every track. */
export const DIMENSIONS = [
  { key: "correctness", label: "Objective correctness", blurb: "Reached the required end-state - the core task." },
  { key: "rigor", label: "Security rigor", blurb: "Did it properly: least privilege, defence in depth, tuned - not the minimum." },
  { key: "no_new_exposure", label: "No new exposure", blurb: "Closed the issue without leaving or opening another way in." },
  { key: "operational_safety", label: "Operational safety", blurb: "Did not break the workload, the pipeline or the alerting to get there." },
];

/** The four product tracks. A lab belongs to exactly one. */
export const TRACKS = [
  { key: "aws", label: "AWS security" },
  { key: "azure", label: "Azure security" },
  { key: "ai", label: "AI security", note: "runs on the cloud providers' model services" },
  { key: "soc", label: "SOC / detection & response", note: "SIEM: Sentinel or Wazuh · SOAR: Sentinel or Shuffle" },
];

/**
 * WHAT SURFACE the work touched. Cloud-neutral names; `equivalents` lists the
 * provider/vendor instantiations so a new one maps in without a new domain.
 * `live: true` means at least one SHIPPED, gradeable lab covers it today.
 */
export const DOMAINS = [
  // ---- cloud posture (aws + azure tracks) ----------------------------------
  { key: "identity", group: "Cloud posture", label: "Identity & access",
    equivalents: "AWS IAM · Microsoft Entra ID / Azure RBAC · GCP IAM", live: true },
  { key: "data_protection", group: "Cloud posture", label: "Data protection",
    equivalents: "S3 · Azure Storage · KMS / Key Vault · Secrets Manager", live: true },
  { key: "network", group: "Cloud posture", label: "Network exposure",
    equivalents: "Security Groups / NACLs · Azure NSGs · firewall rules", live: false },
  { key: "workload", group: "Cloud posture", label: "Workload & compute",
    equivalents: "Lambda / Functions config · container and image posture", live: false },
  { key: "governance", group: "Cloud posture", label: "Governance guardrails",
    equivalents: "AWS Config rules · Azure Policy · account-local policy proxies", live: false },

  // ---- detection & response (soc track, partly cloud) ----------------------
  { key: "telemetry", group: "Detection & response", label: "Log pipeline & telemetry",
    equivalents: "Sentinel data connectors · Wazuh agents/decoders · CloudTrail / Activity Log onboarding, retention, coverage gaps", live: false },
  { key: "detection_engineering", group: "Detection & response", label: "Detection engineering",
    equivalents: "Sentinel analytics rules (KQL) · Wazuh rules/decoders · MITRE ATT&CK mapping · false-positive tuning", live: false },
  { key: "triage", group: "Detection & response", label: "Alert triage & investigation",
    equivalents: "incident severity + attribution · true/false-positive calls · pivoting across evidence", live: false },
  { key: "orchestration", group: "Detection & response", label: "Response automation (SOAR)",
    equivalents: "Sentinel playbooks / Logic Apps · Shuffle workflows · enrichment, approval gates, auto-containment", live: false },
  { key: "incident_response", group: "Detection & response", label: "Containment & recovery",
    equivalents: "credential containment · host/identity isolation · blast-radius control · evidence preservation", live: false },

  // ---- AI security (ai track) ---------------------------------------------
  { key: "ai_guardrails", group: "AI security", label: "Model guardrails & abuse resistance",
    equivalents: "Bedrock Guardrails · Azure OpenAI content filters · prompt-injection and jailbreak defence", live: true },
  { key: "ai_access", group: "AI security", label: "Model & agent access control",
    equivalents: "least-privilege model invocation · agent tool/action scoping · RAG source permissions", live: true },
  { key: "ai_data", group: "AI security", label: "AI data protection",
    equivalents: "prompt/response PII leakage · training-data boundaries · model invocation logging", live: true },
];

const DIMENSION_KEYS = new Set(DIMENSIONS.map((d) => d.key));
const DOMAIN_KEYS = new Set(DOMAINS.map((d) => d.key));

/** Every dimension x domain cell the MODEL can express. A capability statement
 *  about the framework - NOT a per-candidate number, and not a claim that all of
 *  them ship today. Pair it with LIVE_FRAME_SIZE in any copy. */
export const FRAME_SIZE = DIMENSIONS.length * DOMAINS.length;

/** The subset backed by a shipped, gradeable lab right now. This is the number
 *  that is safe to put next to the word "today". */
export const LIVE_DOMAINS = DOMAINS.filter((d) => d.live);
export const LIVE_FRAME_SIZE = DIMENSIONS.length * LIVE_DOMAINS.length;

/**
 * countParameters(criteria): how many VERIFIED PARAMETERS this assessment actually
 * measured, plus the frame coverage it touched.
 *
 * Counting rule, chosen so the number survives a buyer poking at it:
 *  - a criterion WITH sub-checks counts as its sub-check count (each sub-check is an
 *    independently verified statement about a real resource);
 *  - a criterion WITHOUT sub-checks counts as 1;
 *  - criteria that could not be verified are EXCLUDED - we never count a check we
 *    did not actually complete.
 * Advisory evidence (time on task, work timeline, recording, reflection) is
 * deliberately NOT counted. It is evidence we surface, not a parameter we score,
 * and conflating them would mean marketing a dimension we do not grade.
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
    liveFrameSize: LIVE_FRAME_SIZE,
  };
}
