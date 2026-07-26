// E11 — per-variant self-test harness for the S3 misconfig-variance lab.
//
// Why this exists: last week's adversarial review caught a variant (C) that would
// have DEPLOY-FAILED for ~20% of live sessions — a pre-planted "deny unencrypted
// PutObject" statement blocked the seeder Lambda's own write, so the stack rolled
// back before a candidate ever saw it. That was found by reading code closely; a
// harness that actually deploys every variant would have caught it in minutes.
// This is that harness, and it is the ship gate the content plan (§7 E11) requires
// before `LAB_VARIANCE=1` is ever flipped: deploy -> grade seeded (expect all
// planted criteria FAIL) -> apply a scripted fix -> re-grade (expect all PASS) ->
// delete the stack. `ready:true`-for-variance is per VARIANT, not per scenario.
//
//   node verify-variants.mjs [accountId] [variant ...]
//   node verify-variants.mjs 511568812872              # all 5 variants
//   node verify-variants.mjs 511568812872 C D           # just C and D
//
// Uses a sandbox account directly (NOT the lease/pool machinery — this is an
// engineering test, not a candidate session) so it can run standalone against any
// account you point it at. Each variant gets its own stack name and is deleted
// before the next starts; nothing here touches aws-nuke or the account pool state.
import { CloudFormationClient, CreateStackCommand, DeleteStackCommand, waitUntilStackCreateComplete, waitUntilStackDeleteComplete, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { S3Client, PutBucketPolicyCommand, DeleteBucketPolicyCommand, PutPublicAccessBlockCommand, GetBucketPolicyCommand } from "@aws-sdk/client-s3";
import { IAMClient, PutUserPolicyCommand } from "@aws-sdk/client-iam";
import { assumeInSandbox } from "./labinfra.mjs";
import { gradeLab } from "./graders.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGION = "us-east-1";
const SLUG = "s3-misconfiguration-audit";
const PLATFORM_LAB_ROLE = "ShieldSyncLabExec"; // full-admin deploy/nuke role, same one deployStack uses

const ACCOUNT = process.argv[2];
const ONLY = process.argv.slice(3);
const ALL_VARIANTS = ["base", "A", "B", "C", "D"];
const VARIANTS = ONLY.length ? ONLY.filter((v) => ALL_VARIANTS.includes(v)) : ALL_VARIANTS;

if (!ACCOUNT) {
  console.error("usage: node verify-variants.mjs <accountId> [variant ...]");
  process.exit(1);
}

async function creds() {
  const roleArn = `arn:aws:iam::${ACCOUNT}:role/${PLATFORM_LAB_ROLE}`;
  const c = await assumeInSandbox(roleArn, "verify-variants", 900);
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

function clientsFor(credentials) {
  return {
    cfn: new CloudFormationClient({ region: REGION, credentials, maxAttempts: 5, retryMode: "adaptive" }),
    s3: new S3Client({ region: REGION, credentials }),
    iam: new IAMClient({ region: REGION, credentials }),
  };
}

// Expected planted set per variant — must match graders.mjs S3_VARIANT_PLANTS.
// Keeping an independent copy here is deliberate: if a future edit changes one
// table and not the other, this harness's own assertions (not just the grader)
// will catch the drift, because step 3 checks against BOTH.
const EXPECT_FAIL = {
  base: ["no-public-buckets", "least-privilege-iam", "encryption-required", "tls-only", "no-anonymous-grant"],
  A: ["no-public-buckets", "least-privilege-iam", "encryption-required", "no-anonymous-grant"],
  B: ["no-public-buckets", "least-privilege-iam", "encryption-required", "tls-only"],
  C: ["no-public-buckets", "least-privilege-iam", "tls-only", "no-anonymous-grant"],
  D: ["no-public-buckets", "encryption-required", "tls-only", "no-anonymous-grant"],
};
// Always expected to pass even in the seeded (broken) state.
const ALWAYS_PASS_SEEDED = ["resources-intact"];

async function deployVariant(cfn, variant) {
  const stackName = `sslab-selftest-${SLUG}-${variant.toLowerCase()}-${Date.now()}`.slice(0, 120);
  // __dirname is engine/; the lab templates live one level up at labs/<slug>/
  // (same layout deployStack reads in labinfra.mjs).
  const templatePath = join(__dirname, "..", "labs", SLUG, "template.yaml");
  const templateBody = readFileSync(templatePath, "utf8");
  await cfn.send(new CreateStackCommand({
    StackName: stackName,
    TemplateBody: templateBody,
    Capabilities: ["CAPABILITY_NAMED_IAM"],
    OnFailure: "DELETE", // matches deployStack's own contract — no debris on a bad variant
    Parameters: [{ ParameterKey: "Variant", ParameterValue: variant }],
  }));
  await waitUntilStackCreateComplete({ client: cfn, maxWaitTime: 600 }, { StackName: stackName });
  return stackName;
}

// Scripted remediation of EVERY possible flaw. Applying all of them regardless
// of which the variant actually planted is deliberate: it proves the grader's
// per-variant criterion DROPPING (not the remediation script) is what limits the
// scored set — an over-fixed environment must still show exactly the variant's
// criteria as pass, nothing more, nothing fewer.
async function remediate(s3, iam, accountId) {
  const buckets = [`sslab-data-${accountId}`, `sslab-assets-${accountId}`];
  for (const b of buckets) {
    await s3.send(new PutPublicAccessBlockCommand({
      Bucket: b,
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    })).catch(() => {});
    let existing = null;
    try {
      const gp = await s3.send(new GetBucketPolicyCommand({ Bucket: b }));
      existing = JSON.parse(gp.Policy);
    } catch { /* no policy — fine, we're about to write a clean one */ }
    const keep = (existing?.Statement ?? []).filter(
      (st) => st.Sid !== "PublicReadGetObject" // strip only the planted public grant; keep any pre-applied enc/tls Deny as-is
    );
    const hasEnc = keep.some((st) => st.Sid === "DenyUnencryptedObjectUploads");
    const hasTls = keep.some((st) => st.Sid === "DenyInsecureTransport");
    const statements = [...keep];
    if (!hasEnc) {
      statements.push({
        Sid: "DenyUnencryptedObjectUploads", Effect: "Deny", Principal: "*", Action: "s3:PutObject",
        Resource: `arn:aws:s3:::${b}/*`, Condition: { Null: { "s3:x-amz-server-side-encryption": "true" } },
      });
    }
    if (!hasTls) {
      statements.push({
        Sid: "DenyInsecureTransport", Effect: "Deny", Principal: "*", Action: "s3:*",
        Resource: [`arn:aws:s3:::${b}`, `arn:aws:s3:::${b}/*`], Condition: { Bool: { "aws:SecureTransport": "false" } },
      });
    }
    if (statements.length > 0) {
      await s3.send(new PutBucketPolicyCommand({ Bucket: b, Policy: JSON.stringify({ Version: "2012-10-17", Statement: statements }) }));
    } else {
      await s3.send(new DeleteBucketPolicyCommand({ Bucket: b })).catch(() => {});
    }
  }
  // Scope the auditor user to read-only on the lab buckets.
  await iam.send(new PutUserPolicyCommand({
    UserName: "auditor",
    PolicyName: "s3-full-access-everywhere",
    PolicyDocument: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["s3:GetObject", "s3:ListBucket"], Resource: buckets.flatMap((b) => [`arn:aws:s3:::${b}`, `arn:aws:s3:::${b}/*`]) }],
    }),
  }));
}

function criterionMap(criteria) {
  return Object.fromEntries(criteria.map((c) => [c.id, c]));
}

async function runVariant(variant) {
  console.log(`\n${"=".repeat(60)}\nVARIANT ${variant}\n${"=".repeat(60)}`);
  const c1 = await creds();
  const { cfn, s3, iam } = clientsFor(c1);
  let stackName;
  const result = { variant, deployed: false, seededOk: false, fixedOk: false, error: null };

  try {
    stackName = await deployVariant(cfn, variant);
    result.deployed = true;
    console.log(`  deployed: ${stackName}`);

    // --- seeded (all-broken) state: every planted criterion must FAIL ---
    const c2 = await creds();
    const seeded = criterionMap((await gradeLab(SLUG, `arn:aws:iam::${ACCOUNT}:role/${PLATFORM_LAB_ROLE}`, ACCOUNT)).criteria);
    const wantFail = EXPECT_FAIL[variant];
    const gotIds = Object.keys(seeded);
    const unexpectedIds = gotIds.filter((id) => !wantFail.includes(id) && !ALWAYS_PASS_SEEDED.includes(id));
    if (unexpectedIds.length) {
      throw new Error(`grader returned criteria not in the expected-planted set for ${variant}: ${unexpectedIds.join(", ")} — S3_VARIANT_PLANTS drift?`);
    }
    for (const id of wantFail) {
      const crit = seeded[id];
      if (!crit) throw new Error(`expected planted criterion "${id}" missing from grader output for variant ${variant}`);
      if (crit.passed || crit.unknown) throw new Error(`"${id}" should FAIL in the seeded state for variant ${variant}, got passed=${crit.passed} unknown=${crit.unknown}`);
    }
    for (const id of ALWAYS_PASS_SEEDED) {
      const crit = seeded[id];
      if (!crit || !crit.passed) throw new Error(`"${id}" should PASS even seeded — bucket existence must not depend on remediation`);
    }
    result.seededOk = true;
    console.log(`  seeded state OK — ${wantFail.length} planted criteria all fail, resources-intact passes`);

    // --- remediate, then every scored criterion must PASS ---
    await remediate(s3, iam, ACCOUNT);
    // IAM/S3 policy propagation lag is real (verify-leastpriv sees the same thing) —
    // give it a moment before re-grading rather than racing a false negative.
    await new Promise((r) => setTimeout(r, 8000));
    const fixed = criterionMap((await gradeLab(SLUG, `arn:aws:iam::${ACCOUNT}:role/${PLATFORM_LAB_ROLE}`, ACCOUNT)).criteria);
    const failing = Object.values(fixed).filter((c) => !c.passed || c.unknown);
    if (failing.length) {
      throw new Error(`after remediation, still failing/unknown: ${failing.map((c) => c.id).join(", ")}`);
    }
    result.fixedOk = true;
    console.log(`  remediated state OK — all ${Object.keys(fixed).length} scored criteria pass`);
  } catch (e) {
    result.error = e.message;
    console.error(`  FAIL: ${e.message}`);
  } finally {
    if (stackName) {
      try {
        const c3 = await creds();
        const cfn2 = new CloudFormationClient({ region: REGION, credentials: c3, maxAttempts: 5, retryMode: "adaptive" });
        await cfn2.send(new DeleteStackCommand({ StackName: stackName }));
        await waitUntilStackDeleteComplete({ client: cfn2, maxWaitTime: 600 }, { StackName: stackName });
        console.log(`  torn down: ${stackName}`);
      } catch (e) {
        console.error(`  WARNING: teardown failed for ${stackName} — delete it manually: ${e.message}`);
      }
    }
  }
  return result;
}

const results = [];
for (const v of VARIANTS) {
  results.push(await runVariant(v));
}

console.log(`\n${"=".repeat(60)}\nSUMMARY\n${"=".repeat(60)}`);
let allGreen = true;
for (const r of results) {
  const ok = r.deployed && r.seededOk && r.fixedOk;
  allGreen &&= ok;
  console.log(`${ok ? "✓" : "✗"} ${r.variant}${r.error ? `  — ${r.error}` : ""}`);
}
console.log(allGreen ? "\nALL VARIANTS GREEN — safe to flip LAB_VARIANCE=1 on the enterprise engine." : "\nNOT ALL GREEN — do not enable LAB_VARIANCE until every variant is fixed.");
process.exit(allGreen ? 0 : 1);
