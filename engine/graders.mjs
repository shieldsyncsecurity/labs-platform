// ShieldSync Labs — auto-grader. For a live lab session, assume the sandbox's exec
// role and inspect the REAL account state, scoring it against the lab's
// successCriteria (authored in each lab.json). Read-only. The @aws-sdk/* clients
// are provided by the Lambda nodejs runtime.
import {
  S3Client,
  GetBucketPolicyStatusCommand,
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import {
  IAMClient,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRolePolicyCommand,
  ListRolePoliciesCommand,
  ListAttachedRolePoliciesCommand,
} from "@aws-sdk/client-iam";
// TODO/VERIFY (bedrock-prompt-injection, no live AWS access to confirm at authoring
// time): @aws-sdk/client-bedrock is the CONTROL-PLANE client (Guardrails, model
// invocation logging config) — distinct from @aws-sdk/client-bedrock-runtime (used
// only by the lab's own Lambda to call Converse/InvokeModel, not by the grader).
// This package is NOT currently in engine/package.json's dependencies — confirm it
// gets added ("@aws-sdk/client-bedrock": "^3.700.0" or newer, matching the other
// @aws-sdk/client-* pins) and that the Lambda bundling step includes it before this
// grader can run for real. Command/shape names below match the documented Bedrock
// control-plane API as of this writing but are UNVERIFIED against a live call.
// @aws-sdk/client-bedrock is imported LAZILY inside gradeBedrockPromptInjection so
// the engine Lambda still loads even if the control-plane client isn't in the
// runtime bundle. The bedrock lab isn't `ready` yet, so this grader never runs in
// prod — the dynamic import can't fail-at-load. Make it a top-level import again
// once the client is confirmed bundled and the lab is live-tested.
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { assumeInSandbox } from "./labinfra.mjs";

const REGION = "us-east-1";
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

// Inline/managed policy docs come URL-encoded (IAM) or as JSON (S3) — decode safely.
function parsePolicy(doc) {
  if (!doc) return null;
  try {
    return JSON.parse(typeof doc === "string" ? decodeURIComponent(doc) : doc);
  } catch {
    try { return JSON.parse(doc); } catch { return null; }
  }
}

// Does any Allow statement grant an action matching `test` on Resource "*"?
function allowsActionOnStar(policy, test) {
  if (!policy) return false;
  for (const st of asArray(policy.Statement)) {
    if (st.Effect !== "Allow") continue;
    if (!asArray(st.Resource).some((r) => r === "*")) continue;
    if (asArray(st.Action).some((a) => test(String(a)))) return true;
  }
  return false;
}

function hasDeny(policy, predicate) {
  if (!policy) return false;
  return asArray(policy.Statement).some((st) => st.Effect === "Deny" && predicate(st));
}

// AWS errors that genuinely mean "the resource isn't there" — i.e. a valid
// fixed/clean state. ANYTHING else (throttling, AccessDenied, network) means the
// check itself FAILED: we must NOT report a green pass off a failed call, or a
// transient blip reads as "you fixed it". Such criteria are marked `unknown`.
const ABSENCE_ERRORS = new Set(["NoSuchBucketPolicy", "NoSuchPublicAccessBlockConfiguration", "NoSuchEntity"]);
function isAbsenceError(e) {
  const code = e?.name || e?.Code || e?.__type || "";
  return ABSENCE_ERRORS.has(code) || [...ABSENCE_ERRORS].some((n) => String(code).includes(n));
}
// The bucket itself is gone (deleted) — an authoritative, known state. Must be
// matched EXACTLY, not by substring/status: a missing sub-resource ("NoSuchBucketPolicy",
// "NoSuchPublicAccessBlockConfiguration") is ALSO a 404 and its code contains the substring
// "NoSuchBucket", but the bucket still exists. AWS returns code "NoSuchBucket" for Get*/List*
// on a deleted bucket, and HeadBucket surfaces "NotFound". (HeadBucket has no sub-resource, so
// a bare 404 there is unambiguous — its caller handles that separately.)
function isMissingBucket(e) {
  const code = e?.name || e?.Code || e?.__type || "";
  return code === "NoSuchBucket" || code === "NotFound";
}
// Spread into a criterion to flag "couldn't verify" when a non-absence error hit.
const unk = (err) => (err ? { unknown: true } : {});

// ── Per-session variance ─────────────────────────────────────────────────────
// Which flaws each variant PLANTS. A variant that ships a control already
// correct must NOT credit the candidate for it, so the grader drops that
// criterion entirely rather than auto-passing it (which would inflate the score
// and make variants non-comparable). See labs/<slug>/template.yaml Conditions.
const S3_VARIANT_PLANTS = {
  base: { assetsPublic: true, enc: true, tls: true, iam: true },
  A: { assetsPublic: true, enc: true, tls: false, iam: true }, // TLS pre-enforced
  B: { assetsPublic: false, enc: true, tls: true, iam: true }, // assets pre-secured
  C: { assetsPublic: true, enc: false, tls: true, iam: true }, // encryption pre-enforced
  D: { assetsPublic: true, enc: true, tls: true, iam: false }, // IAM pre-scoped
};

/**
 * readLabVariant(): read the variant back off the DEPLOYED stack — authoritative,
 * lives in the candidate's own account, and cannot drift from what was actually
 * built.
 *
 * Returns the variant name, or NULL when it genuinely could not be determined.
 * The null case must NOT be collapsed into "base": "base" means "every flaw was
 * planted, grade all of them", so defaulting an unreadable variant to base hands
 * the candidate a free pass on whichever control their variant shipped
 * already-correct (A->tls-only, C->encryption-required, D->least-privilege-iam).
 * That is fail-OPEN scoring, the exact thing the `unknown` convention in this
 * file exists to prevent. The caller marks the affected criteria `unknown`.
 *
 * A lab stack that exists but declares no Variant parameter is a pre-variance
 * deploy — that IS confidently "base", not an unknown.
 */
async function readLabVariant(creds) {
  try {
    const cfn = new CloudFormationClient({ region: REGION, credentials: creds });
    const r = await cfn.send(new DescribeStacksCommand({}));
    // A sandbox holds exactly one lab stack (warm or cold). Prefer a stack that
    // actually declares Variant; ignore any unrelated/rolled-back stacks.
    let sawLabStack = false;
    for (const st of r.Stacks ?? []) {
      if (!/^sslab-/.test(st.StackName ?? "")) continue;
      if (!["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(st.StackStatus ?? "")) continue;
      sawLabStack = true;
      const p = (st.Parameters ?? []).find((x) => x.ParameterKey === "Variant");
      if (p?.ParameterValue && S3_VARIANT_PLANTS[p.ParameterValue]) return p.ParameterValue;
    }
    if (sawLabStack) return "base"; // pre-variance template — confidently all-flaws
  } catch {
    /* unverifiable — fall through */
  }
  return null;
}

// ── S3 misconfiguration & data exposure ──────────────────────────────────────
async function gradeS3(creds, accountId) {
  const s3 = new S3Client({ region: REGION, credentials: creds });
  const buckets = [`sslab-data-${accountId}`, `sslab-assets-${accountId}`];
  // Which flaws this session actually had planted. null = could not determine.
  const variantRead = await readLabVariant(creds);
  const plants = S3_VARIANT_PLANTS[variantRead ?? "base"] ?? S3_VARIANT_PLANTS.base;
  // An undeterminable variant only threatens SCORING where variants can actually
  // exist. With LAB_VARIANCE off nothing ever deploys a non-base variant, so
  // falling back to "grade everything" is exactly the pre-variance behaviour and
  // must NOT start marking criteria unknown (that would newly deny B2C learners
  // their certificate on a transient DescribeStacks blip). With variance ON, an
  // unreadable variant is a real "could not verify" and is flagged as such.
  const variantUnknown = variantRead === null && process.env.LAB_VARIANCE === "1";
  const vunk = variantUnknown ? { unknown: true } : {};

  const info = {};
  let probeErr = null; // any non-absence error makes the bucket criteria "unknown"
  let existErr = null; // a non-404/non-NoSuchBucket error probing existence → operational check "unknown"
  for (const b of buckets) {
    let isPublic = false, policy = null, bpaRestrict = false, exists = true, existKnown = false;
    // Existence: a candidate who DELETES the bucket to "fix" the exposure has destroyed the
    // workload, not secured it. HeadBucket 404 → gone. A "missing" signal from ANY probe below
    // is also authoritative (deletion is a known state, not an unverifiable error) and must not
    // poison probeErr. Only a genuinely ambiguous error (403/throttle) leaves it unknown.
    try {
      await s3.send(new HeadBucketCommand({ Bucket: b }));
      exists = true; existKnown = true;
    } catch (e) {
      // HeadBucket has no sub-resource, so a 404 (or NotFound/NoSuchBucket) here always
      // means the bucket is gone — unlike the Get* calls where 404 can be "no policy".
      if (isMissingBucket(e) || e?.$metadata?.httpStatusCode === 404) { exists = false; existKnown = true; }
      else existErr = e; // 403/throttle/etc — can't confirm; resources-intact stays "unknown"
    }
    // For the policy/BPA probes: a SUCCESS or a sub-resource-absence error (e.g.
    // NoSuchBucketPolicy) both prove the bucket EXISTS — AWS returns NoSuchBucket,
    // not NoSuchBucketPolicy, when the bucket itself is gone. Either way, confirm
    // existence so resources-intact never falsely reads "unknown" if HeadBucket's
    // permission differs from the Get* permissions.
    try {
      const ps = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: b }));
      isPublic = !!ps.PolicyStatus?.IsPublic;
      existKnown = true;
    } catch (e) {
      if (isMissingBucket(e)) { exists = false; existKnown = true; }
      else if (isAbsenceError(e)) existKnown = true; /* no policy, but bucket exists */
      else probeErr = e;
    }
    try {
      const gp = await s3.send(new GetBucketPolicyCommand({ Bucket: b }));
      policy = parsePolicy(gp.Policy);
      existKnown = true;
    } catch (e) {
      if (isMissingBucket(e)) { exists = false; existKnown = true; }
      else if (isAbsenceError(e)) existKnown = true; /* no policy, but bucket exists */
      else probeErr = e;
    }
    try {
      const ab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: b }));
      bpaRestrict = !!ab.PublicAccessBlockConfiguration?.RestrictPublicBuckets;
      existKnown = true;
    } catch (e) {
      if (isMissingBucket(e)) { exists = false; existKnown = true; }
      else if (isAbsenceError(e)) existKnown = true; /* no BPA set, but bucket exists */
      else probeErr = e;
    }
    info[b] = { isPublic, policy, bpaRestrict, exists, existKnown };
  }

  // Correctness requires an INTACT, non-public bucket. A deleted bucket reads as
  // "not public" to the exposure probes, but deleting is not a fix — so gate on exists.
  const notPublic = (b) => info[b].exists && (!info[b].isPublic || info[b].bpaRestrict);
  const encDeny = (b) =>
    hasDeny(info[b].policy, (st) =>
      asArray(st.Action).some((a) => /s3:PutObject/i.test(a) || a === "s3:*") &&
      JSON.stringify(st.Condition || {}).includes("s3:x-amz-server-side-encryption"));
  const tlsDeny = (b) =>
    hasDeny(info[b].policy, (st) =>
      JSON.stringify(st.Condition || {}).toLowerCase().includes("aws:securetransport"));
  // No-new-exposure: did they leave/introduce an anonymous grant in the bucket policy?
  // A wildcard Principal ("*" or {"AWS":"*"}) on an Allow is an open door even when BPA
  // currently masks IsPublic — flip BPA off and it's public again. A proper fix has none.
  const anonAllow = (st) => {
    if (st.Effect !== "Allow") return false;
    const p = st.Principal;
    if (p === "*") return true;
    if (p && typeof p === "object") return asArray(p.AWS).includes("*") || asArray(p.CanonicalUser).includes("*");
    return false;
  };
  // Purely a policy check — a deleted bucket has no exposure (operational-safety flags the
  // delete). So this passes when there's no anonymous Allow, regardless of existence.
  const noAnonGrant = (b) => !asArray(info[b].policy?.Statement).some(anonAllow);

  // 'auditor' user must no longer hold s3:* (or *) on Resource "*".
  const iam = new IAMClient({ region: REGION, credentials: creds });
  let auditorBroad = false, auditorErr = null;
  try {
    const inline = await iam.send(new ListUserPoliciesCommand({ UserName: "auditor" }));
    for (const pn of inline.PolicyNames ?? []) {
      const up = await iam.send(new GetUserPolicyCommand({ UserName: "auditor", PolicyName: pn }));
      if (allowsActionOnStar(parsePolicy(up.PolicyDocument), (a) => a === "s3:*" || a === "*")) auditorBroad = true;
    }
  } catch (e) { if (!isAbsenceError(e)) auditorErr = e; /* else: user removed → scoped */ }

  const bothIntact = buckets.every((b) => info[b].exists);
  // Only claim intact/deleted if existence was actually confirmed for every bucket; if any
  // probe was ambiguous (403/throttle, never a definitive 200 or missing), report "unknown".
  const existUnverified = buckets.some((b) => !info[b].existKnown) ? (existErr || true) : null;

  // Criteria for a control this variant shipped ALREADY CORRECT are dropped, not
  // auto-passed: the candidate did no work for them, so counting them would
  // inflate the score and make variants incomparable. The always-present ones
  // still demand real work in every variant (the data bucket is public in all of
  // them), or are "don't break it" checks that apply regardless.
  // PER-RESOURCE SUB-CHECKS. A criterion stays PASS only when every bucket
  // satisfies it (semantics unchanged, so scoring and ranking are untouched),
  // but it now carries the per-bucket detail. Without this a candidate who
  // secured the data bucket and missed the assets bucket scored EXACTLY the
  // same as one who did nothing at all - five of the six criteria here are
  // buckets.every(), so partial progress was being discarded wholesale.
  // Reliability/statistics are still computed at the CRITERION level (sub-checks
  // within a criterion are correlated, so treating them as independent items
  // would be fake precision) - these exist to make the report legible and to
  // aim the interviewer at the exact resource that was missed.
  const shortName = (b) => (b.startsWith("sslab-data-") ? "data bucket" : b.startsWith("sslab-assets-") ? "assets bucket" : b);
  const subs = (fn) => buckets.map((b) => ({ id: b, label: shortName(b), passed: !!fn(b) }));

  const criteria = [
    // Correctness — did they achieve the required secure end-state (the core objective)?
    { id: "no-public-buckets", domain: "data_protection", dimension: "correctness", description: "No lab bucket allows anonymous public read.", passed: buckets.every(notPublic), subChecks: subs(notPublic), ...unk(probeErr) },
  ];
  // Security rigor — did they harden properly (least-privilege + defence-in-depth), not just the minimum?
  // These three are the variant-dependent ones. When the variant is unreadable we
  // keep all three (we cannot know which were dropped) but mark them `unknown`, so
  // a control the environment may have shipped already-correct can never be scored
  // as the candidate's own work.
  if (plants.iam) {
    criteria.push({ id: "least-privilege-iam", domain: "identity", dimension: "rigor", description: "The 'auditor' user no longer has s3:* on Resource '*'.", passed: !auditorBroad, ...unk(auditorErr), ...vunk });
  }
  if (plants.enc) {
    criteria.push({ id: "encryption-required", domain: "data_protection", dimension: "rigor", description: "Each bucket denies unencrypted PutObject.", passed: buckets.every(encDeny), subChecks: subs(encDeny), ...unk(probeErr), ...vunk });
  }
  if (plants.tls) {
    criteria.push({ id: "tls-only", domain: "data_protection", dimension: "rigor", description: "Each bucket denies non-TLS (HTTP) requests.", passed: buckets.every(tlsDeny), subChecks: subs(tlsDeny), ...unk(probeErr), ...vunk });
  }
  criteria.push(
    // No new exposure — did the fix avoid leaving/opening an anonymous door?
    { id: "no-anonymous-grant", domain: "data_protection", dimension: "no_new_exposure", description: "No bucket policy grants a wildcard (anonymous) principal.", passed: buckets.every(noAnonGrant), subChecks: subs(noAnonGrant), ...unk(probeErr) },
    // Operational safety — did they secure the workload without destroying it?
    { id: "resources-intact", domain: "data_protection", dimension: "operational_safety", description: "Both lab buckets still exist (secured, not deleted).", passed: bothIntact, subChecks: subs((b) => info[b].exists), ...unk(existUnverified) }
  );
  return criteria;
}

// ── IAM privilege escalation ─────────────────────────────────────────────────
async function gradeIam(creds) {
  const iam = new IAMClient({ region: REGION, credentials: creds });
  const user = "pipeline-deployer";

  let attached = { AttachedPolicies: [] };
  let adminAttached = false, primErr = null;
  try {
    attached = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: user }));
    adminAttached = (attached.AttachedPolicies ?? []).some((p) => /AdministratorAccess/i.test(p.PolicyArn || ""));
    const inline = await iam.send(new ListUserPoliciesCommand({ UserName: user }));
    for (const pn of inline.PolicyNames ?? []) {
      const up = await iam.send(new GetUserPolicyCommand({ UserName: user, PolicyName: pn }));
      if (allowsActionOnStar(parsePolicy(up.PolicyDocument), (a) => a === "*" || a === "iam:*")) adminAttached = true;
    }
  } catch (e) { if (!isAbsenceError(e)) primErr = e; }

  // LabDeployerPolicy default version must not grant an IAM-write primitive on "*".
  let escalation = false, escErr = null;
  const labPolicy = (attached.AttachedPolicies ?? []).find((p) => /LabDeployerPolicy/i.test(p.PolicyName || ""));
  if (labPolicy) {
    try {
      const gp = await iam.send(new GetPolicyCommand({ PolicyArn: labPolicy.PolicyArn }));
      const ver = gp?.Policy?.DefaultVersionId;
      if (ver) {
        const pv = await iam.send(new GetPolicyVersionCommand({ PolicyArn: labPolicy.PolicyArn, VersionId: ver }));
        const pol = parsePolicy(pv.PolicyVersion?.Document);
        if (allowsActionOnStar(pol, (a) => /^iam:(Attach|Put|Create|SetDefault|PassRole)/i.test(a) || a === "iam:*" || a === "*")) escalation = true;
      }
    } catch (e) { if (!isAbsenceError(e)) escErr = e; }
  }

  // Legitimate function preserved: the user can still read S3 (s3:GetObject granted
  // somewhere in its policies). Inspect the policy DOCUMENTS directly rather than
  // SimulatePrincipalPolicy — the simulator is subject to eventual consistency on a
  // freshly-attached policy, which made a fresh deployer read as "broken" (a false
  // negative → fresh baseline 1/3 instead of the intended 2/3). Accepts both the
  // original Resource:"*" read and a remediated scoped read.
  let stillWorks = false, simErr = null;
  try {
    const docs = [];
    for (const p of attached.AttachedPolicies ?? []) {
      const gp = await iam.send(new GetPolicyCommand({ PolicyArn: p.PolicyArn }));
      const ver = gp?.Policy?.DefaultVersionId;
      if (ver) {
        const pv = await iam.send(new GetPolicyVersionCommand({ PolicyArn: p.PolicyArn, VersionId: ver }));
        docs.push(parsePolicy(pv.PolicyVersion?.Document));
      }
    }
    const inlineRead = await iam.send(new ListUserPoliciesCommand({ UserName: user }));
    for (const pn of inlineRead.PolicyNames ?? []) {
      const up = await iam.send(new GetUserPolicyCommand({ UserName: user, PolicyName: pn }));
      docs.push(parsePolicy(up.PolicyDocument));
    }
    const grantsRead = (pol) =>
      !!pol && asArray(pol.Statement).some((st) =>
        st.Effect === "Allow" &&
        asArray(st.Action).some((a) => a === "s3:GetObject" || a === "s3:*" || a === "*"));
    stillWorks = docs.some(grantsRead);
  } catch (e) { if (!isAbsenceError(e)) simErr = e; }

  return [
    { id: "admin-detached", domain: "identity", dimension: "correctness", description: "AdministratorAccess is no longer attached to pipeline-deployer.", passed: !adminAttached, ...unk(primErr) },
    { id: "escalation-primitive-removed", domain: "identity", dimension: "no_new_exposure", description: "LabDeployerPolicy no longer grants iam:AttachUserPolicy (or other IAM-write) on '*'.", passed: !escalation, ...unk(primErr || escErr) },
    { id: "deployer-still-works", domain: "identity", dimension: "operational_safety", description: "The user keeps its legitimate read permissions (s3:GetObject still allowed).", passed: stillWorks, ...unk(simErr) },
  ];
}

// ── Bedrock prompt injection & Guardrails ────────────────────────────────────
// TODO/VERIFY (no live AWS access at authoring time — flagged in the lab build
// report): every SDK call shape below is written against the DOCUMENTED Bedrock
// control-plane API, not confirmed against a live account. Before this lab flips
// to launch-ready, deploy the stack, run through the fix, and re-grade to confirm:
//   - ListGuardrailsCommand's response shape (guardrails[].id / .arn / .status)
//   - GetGuardrailCommand's response shape (topicPolicy.topics[] vs
//     topicPolicyConfig — the *Config suffix is the CREATE-request shape; the
//     GET-response shape may differ, e.g. `topicPolicy` not `topicPolicyConfig`)
//   - GetModelInvocationLoggingConfigurationCommand's response shape
//     (loggingConfig.cloudWatchConfig / .s3Config vs a differently-nested field)
// If ANY of these shapes are wrong, the try/catch below will surface it as a
// non-absence error -> the criterion reports `unknown: true` (never a false
// pass), so a shape mismatch fails safe, but should still be fixed before ready:true.
const NOVA_LITE_ID = "amazon.nova-lite-v1:0";
const ASSISTANT_ROLE_POLICY_NAME = "bedrock-over-broad-invoke";

// Does this guardrail (from a GetGuardrail response) have a real denied-topic or
// denied-content policy configured (not just an empty/default guardrail)?
function guardrailHasDeniedPolicy(g) {
  if (!g) return false;
  const topics =
    g.topicPolicy?.topics ?? g.topicPolicyConfig?.topicsConfig ?? [];
  const contentFilters =
    g.contentPolicy?.filters ?? g.contentPolicyConfig?.filtersConfig ?? [];
  return (asArray(topics).length > 0 && asArray(topics).some((t) => (t.type || "DENY") === "DENY")) ||
    asArray(contentFilters).length > 0;
}

// Does the assistant role's policy grant bedrock:InvokeModel scoped to exactly
// the Nova Lite model ARN, with NO bedrock:* and NO bedrock action on Resource "*"?
function isInvokeScopedToNovaLite(policy) {
  if (!policy) return false;
  let hasScopedInvoke = false;
  let hasOverBroad = false;
  for (const st of asArray(policy.Statement)) {
    if (st.Effect !== "Allow") continue;
    const actions = asArray(st.Action).map(String);
    const resources = asArray(st.Resource).map(String);
    const grantsBedrockStar = actions.some((a) => a === "bedrock:*" || a === "*");
    const grantsInvoke = actions.some((a) => a === "bedrock:InvokeModel");
    const onStar = resources.some((r) => r === "*");
    if (grantsBedrockStar && onStar) hasOverBroad = true;
    // Any bedrock action (not just InvokeModel) on Resource "*" is over-broad too.
    if (onStar && actions.some((a) => String(a).startsWith("bedrock:"))) hasOverBroad = true;
    if (grantsInvoke && resources.some((r) => r.includes(NOVA_LITE_ID)) && !onStar) hasScopedInvoke = true;
  }
  return hasScopedInvoke && !hasOverBroad;
}

async function gradeBedrockPromptInjection(creds, accountId) {
  const {
    BedrockClient,
    ListGuardrailsCommand,
    GetGuardrailCommand,
    GetModelInvocationLoggingConfigurationCommand,
  } = await import("@aws-sdk/client-bedrock");
  const bedrock = new BedrockClient({ region: REGION, credentials: creds });
  const iam = new IAMClient({ region: REGION, credentials: creds });

  // ── guardrail-attached ──────────────────────────────────────────────────
  let guardrailOk = false, guardrailErr = null;
  try {
    const list = await bedrock.send(new ListGuardrailsCommand({}));
    const guardrails = list.guardrails ?? [];
    for (const g of guardrails) {
      try {
        const id = g.id ?? g.guardrailId;
        if (!id) continue;
        const detail = await bedrock.send(new GetGuardrailCommand({ guardrailIdentifier: id }));
        if (guardrailHasDeniedPolicy(detail)) { guardrailOk = true; break; }
      } catch (e) {
        if (!isAbsenceError(e)) guardrailErr = e; // else: this guardrail vanished mid-check, keep scanning
      }
    }
  } catch (e) {
    // No guardrails yet is NOT an absence-error code from ListGuardrails (it
    // returns an empty array, not a NotFound), so any thrown error here is real.
    guardrailErr = e;
  }

  // ── invoke-least-privilege ──────────────────────────────────────────────
  // The lab's role is created by template.yaml with Path: /lab/ and an inline
  // policy named ASSISTANT_ROLE_POLICY_NAME. The learner may keep it inline
  // (put-role-policy, same name) or the grader also checks for a differently-
  // named inline policy / an attached managed policy, since the instructions
  // only ask the learner to edit the existing inline policy in place.
  let roleName = null;
  let invokeOk = false, invokeErr = null;
  try {
    // Discover the lab role by convention: template.yaml names it
    // sslab-bedrock-assistant-<region> (see Outputs.AssistantRoleName). The
    // grader is handed accountId but not the exact role name, so it derives it
    // from the fixed naming convention rather than requiring a lookup API that
    // needs a resource name anyway.
    roleName = `sslab-bedrock-assistant-${REGION}`;
    const policyDocs = [];
    try {
      const inlineNames = await iam.send(new ListRolePoliciesCommand({ RoleName: roleName }));
      for (const pn of inlineNames.PolicyNames ?? []) {
        const p = await iam.send(new GetRolePolicyCommand({ RoleName: roleName, PolicyName: pn }));
        policyDocs.push(parsePolicy(p.PolicyDocument));
      }
    } catch (e) { if (!isAbsenceError(e)) invokeErr = e; }
    try {
      const attached = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
      for (const p of attached.AttachedPolicies ?? []) {
        const gp = await iam.send(new GetPolicyCommand({ PolicyArn: p.PolicyArn }));
        const ver = gp?.Policy?.DefaultVersionId;
        if (ver) {
          const pv = await iam.send(new GetPolicyVersionCommand({ PolicyArn: p.PolicyArn, VersionId: ver }));
          policyDocs.push(parsePolicy(pv.PolicyVersion?.Document));
        }
      }
    } catch (e) { if (!isAbsenceError(e)) invokeErr = e; }
    invokeOk = policyDocs.some(isInvokeScopedToNovaLite) &&
      !policyDocs.some((pol) => pol && asArray(pol.Statement).some((st) =>
        st.Effect === "Allow" &&
        asArray(st.Resource).some((r) => r === "*") &&
        asArray(st.Action).some((a) => String(a) === "bedrock:*" || String(a) === "*" || String(a).startsWith("bedrock:"))));
  } catch (e) { if (!isAbsenceError(e)) invokeErr = e; }

  // ── model-logging-enabled ────────────────────────────────────────────────
  let loggingOk = false, loggingErr = null;
  try {
    const cfg = await bedrock.send(new GetModelInvocationLoggingConfigurationCommand({}));
    const lc = cfg.loggingConfig;
    loggingOk = !!(lc && (lc.cloudWatchConfig || lc.s3Config));
  } catch (e) {
    // A ResourceNotFoundException-style response here (no logging configured
    // yet) is the expected BROKEN state, not a grading failure — but VERIFY the
    // actual error name Bedrock returns for "logging never configured" (it may
    // be a normal 200 with an empty loggingConfig instead of a thrown error —
    // if so, the try block above already handles that via the `!!(lc && ...)`
    // check and this catch only fires on a real fault).
    if (!isAbsenceError(e)) loggingErr = e;
  }

  return [
    { id: "guardrail-attached", domain: "ai_guardrails", dimension: "correctness", description: "A Bedrock Guardrail exists with a denied-topic/content policy configured.", passed: guardrailOk, ...unk(guardrailErr) },
    { id: "invoke-least-privilege", domain: "ai_access", dimension: "rigor", description: "The assistant's invoke role allows bedrock:InvokeModel scoped to the Nova Lite model ARN only — no bedrock:* and no Resource '*'.", passed: invokeOk, ...unk(invokeErr) },
    { id: "model-logging-enabled", domain: "ai_data", dimension: "rigor", description: "Bedrock model-invocation logging is configured with a destination.", passed: loggingOk, ...unk(loggingErr) },
  ];
}

/**
 * gradeLab(): assume the sandbox exec role and score the lab against its criteria.
 * Returns { gradable, criteria: [{id, description, passed}], passed }.
 */
export async function gradeLab(labSlug, execRoleArn, accountId) {
  const c = await assumeInSandbox(execRoleArn, "engine-grade");
  const creds = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
  let criteria = null;
  if (labSlug === "s3-misconfiguration-audit") criteria = await gradeS3(creds, accountId);
  else if (labSlug === "iam-privilege-escalation") criteria = await gradeIam(creds);
  else if (labSlug === "bedrock-prompt-injection") criteria = await gradeBedrockPromptInjection(creds, accountId);
  if (!criteria) return { gradable: false, criteria: [], passed: false };
  // Overall pass requires every criterion verified passing — an `unknown`
  // (a check that couldn't run) never counts as a pass.
  return { gradable: true, criteria, passed: criteria.every((x) => x.passed === true && !x.unknown) };
}
