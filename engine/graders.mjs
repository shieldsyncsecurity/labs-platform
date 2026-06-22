// ShieldSync Labs — auto-grader. For a live lab session, assume the sandbox's exec
// role and inspect the REAL account state, scoring it against the lab's
// successCriteria (authored in each lab.json). Read-only. The @aws-sdk/* clients
// are provided by the Lambda nodejs runtime.
import {
  S3Client,
  GetBucketPolicyStatusCommand,
  GetBucketPolicyCommand,
  GetPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  IAMClient,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  GetUserPolicyCommand,
  GetUserCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  SimulatePrincipalPolicyCommand,
} from "@aws-sdk/client-iam";
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
// Spread into a criterion to flag "couldn't verify" when a non-absence error hit.
const unk = (err) => (err ? { unknown: true } : {});

// ── S3 misconfiguration & data exposure ──────────────────────────────────────
async function gradeS3(creds, accountId) {
  const s3 = new S3Client({ region: REGION, credentials: creds });
  const buckets = [`sslab-data-${accountId}`, `sslab-assets-${accountId}`];

  const info = {};
  let probeErr = null; // any non-absence error makes the bucket criteria "unknown"
  for (const b of buckets) {
    let isPublic = false, policy = null, bpaRestrict = false;
    try {
      const ps = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: b }));
      isPublic = !!ps.PolicyStatus?.IsPublic;
    } catch (e) { if (!isAbsenceError(e)) probeErr = e; /* else: no policy → not public */ }
    try {
      const gp = await s3.send(new GetBucketPolicyCommand({ Bucket: b }));
      policy = parsePolicy(gp.Policy);
    } catch (e) { if (!isAbsenceError(e)) probeErr = e; /* else: no policy */ }
    try {
      const ab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: b }));
      bpaRestrict = !!ab.PublicAccessBlockConfiguration?.RestrictPublicBuckets;
    } catch (e) { if (!isAbsenceError(e)) probeErr = e; /* else: no BPA set */ }
    info[b] = { isPublic, policy, bpaRestrict };
  }

  const notPublic = (b) => !info[b].isPublic || info[b].bpaRestrict;
  const encDeny = (b) =>
    hasDeny(info[b].policy, (st) =>
      asArray(st.Action).some((a) => /s3:PutObject/i.test(a) || a === "s3:*") &&
      JSON.stringify(st.Condition || {}).includes("s3:x-amz-server-side-encryption"));
  const tlsDeny = (b) =>
    hasDeny(info[b].policy, (st) =>
      JSON.stringify(st.Condition || {}).toLowerCase().includes("aws:securetransport"));

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

  return [
    { id: "no-public-buckets", description: "No lab bucket allows anonymous public read.", passed: buckets.every(notPublic), ...unk(probeErr) },
    { id: "encryption-required", description: "Each bucket denies unencrypted PutObject.", passed: buckets.every(encDeny), ...unk(probeErr) },
    { id: "tls-only", description: "Each bucket denies non-TLS (HTTP) requests.", passed: buckets.every(tlsDeny), ...unk(probeErr) },
    { id: "least-privilege-iam", description: "The 'auditor' user no longer has s3:* on Resource '*'.", passed: !auditorBroad, ...unk(auditorErr) },
  ];
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

  // Legitimate function preserved: s3:GetObject still allowed for the user.
  let stillWorks = false, simErr = null;
  try {
    const gu = await iam.send(new GetUserCommand({ UserName: user }));
    if (gu?.User?.Arn) {
      const sim = await iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: gu.User.Arn, ActionNames: ["s3:GetObject"] }));
      stillWorks = sim?.EvaluationResults?.[0]?.EvalDecision === "allowed";
    }
  } catch (e) { if (!isAbsenceError(e)) simErr = e; }

  return [
    { id: "admin-detached", description: "AdministratorAccess is no longer attached to pipeline-deployer.", passed: !adminAttached, ...unk(primErr) },
    { id: "escalation-primitive-removed", description: "LabDeployerPolicy no longer grants iam:AttachUserPolicy (or other IAM-write) on '*'.", passed: !escalation, ...unk(primErr || escErr) },
    { id: "deployer-still-works", description: "The user keeps its legitimate read permissions (s3:GetObject still allowed).", passed: stillWorks, ...unk(simErr) },
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
  if (!criteria) return { gradable: false, criteria: [], passed: false };
  // Overall pass requires every criterion verified passing — an `unknown`
  // (a check that couldn't run) never counts as a pass.
  return { gradable: true, criteria, passed: criteria.every((x) => x.passed === true && !x.unknown) };
}
