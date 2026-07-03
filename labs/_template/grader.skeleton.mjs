// GRADER SKELETON — reference only. This file is NOT imported by the engine.
//
// The real grader lives in labs-platform/engine/graders.mjs and is a hand-written
// per-lab dispatch (see LAB-FACTORY.md section 2 — there is no generic "check
// successCriteria against account state" runner). To wire up a new lab:
//
//   1. Copy the function below into engine/graders.mjs, rename gradeTemplateLab to
//      grade<YourLab> (camelCase from the slug), and fill in the TODOs.
//   2. Add the SDK client imports it needs at the top of graders.mjs (S3Client /
//      IAMClient are already imported; add others — e.g. @aws-sdk/client-ec2 — if
//      your lab touches a different service).
//   3. Add a dispatch branch inside gradeLab() in graders.mjs:
//        else if (labSlug === "TODO-slug") criteria = await grade<YourLab>(creds, accountId);
//
// The `id` you return for each criterion MUST exactly match an `id` in this lab's
// successCriteria array (both lab.json copies) — nothing type-checks this; a
// mismatch just makes that objective permanently un-gradeable in the UI.

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
  GetPolicyCommand,
  GetPolicyVersionCommand,
} from "@aws-sdk/client-iam";
// TODO: add other @aws-sdk/client-* imports your checks need.

const REGION = "us-east-1";
const asArray = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

// ── Shared helpers (already exist in graders.mjs — reuse them, don't duplicate) ──
// parsePolicy(doc)                — decode an IAM (URL-encoded) or S3 (plain JSON) policy doc.
// allowsActionOnStar(policy, fn)  — does any Allow statement grant an action matching fn() on Resource "*"?
// hasDeny(policy, predicate)      — does any Deny statement match predicate(statement)?
// isAbsenceError(e) / unk(err)    — see below; copy these two verbatim if this is
//                                    the first custom grader you're adding (they
//                                    already exist in graders.mjs once ANY lab is
//                                    wired up, so normally you just reuse them).

// AWS errors that genuinely mean "the resource isn't there" i.e. a valid
// fixed/clean state — NOT a grading failure. Extend this set if your lab's checks
// hit a resource-absence error code not already covered (e.g. a different
// service's "not found" exception name).
const ABSENCE_ERRORS = new Set(["NoSuchBucketPolicy", "NoSuchPublicAccessBlockConfiguration", "NoSuchEntity"]);
function isAbsenceError(e) {
  const code = e?.name || e?.Code || e?.__type || "";
  return ABSENCE_ERRORS.has(code) || [...ABSENCE_ERRORS].some((n) => String(code).includes(n));
}
// Spread into a criterion to flag "couldn't verify" when a NON-absence error hit —
// an `unknown` criterion never counts as a pass (see gradeLab's final `passed`
// calc: x.passed === true && !x.unknown). This is what stops a transient AWS
// throttle/blip from reading to the learner as "you fixed it".
const unk = (err) => (err ? { unknown: true } : {});

/**
 * grade<YourLab>(creds, accountId): assume-role creds are ALREADY provided by the
 * caller (gradeLab in graders.mjs calls assumeInSandbox before invoking this).
 * Probe the LIVE account, read-only, and return one result per successCriteria id.
 */
async function gradeTemplateLab(creds, accountId) {
  // TODO: instantiate the SDK client(s) you need with the passed-in creds:
  // const s3 = new S3Client({ region: REGION, credentials: creds });
  // const iam = new IAMClient({ region: REGION, credentials: creds });

  // TODO pattern per criterion:
  //   1. try/catch the probe call(s).
  //   2. on error: if isAbsenceError(e) -> that's fine, treat as "resource gone /
  //      fixed"; anything else -> record it (probeErr = e) so the criterion below
  //      spreads ...unk(probeErr) instead of asserting a false pass.
  //   3. compute `passed` from what you found.
  //
  // let probeErr = null;
  // let someState = null;
  // try {
  //   const r = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: "TODO" }));
  //   someState = r.PolicyStatus?.IsPublic;
  // } catch (e) {
  //   if (!isAbsenceError(e)) probeErr = e; // else: absence = fixed state, leave someState as-is
  // }

  return [
    // TODO: one object per successCriteria entry, id MUST match lab.json exactly.
    // { id: "TODO-criterion-id", description: "TODO — human-readable.", passed: /* TODO boolean */ false, ...unk(/* probeErr */ null) },
  ];
}

// TODO delete this default export — it exists only so this skeleton file has SOME
// export and can be sanity-checked with `node --check` without errors.
export { gradeTemplateLab };
