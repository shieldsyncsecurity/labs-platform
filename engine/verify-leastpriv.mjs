// One-off: prove the per-lab least-privilege SESSION POLICY actually scopes the
// learner console. Assumes ShieldSyncLabUser in a pool account WITH the merged
// session policy (same as labLearnerPolicy), then probes allow/deny.
//   node verify-leastpriv.mjs [accountId] [slug]
import { assumeInSandbox } from "./labinfra.mjs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { IAMClient, ListRolesCommand, ListUsersCommand } from "@aws-sdk/client-iam";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNT = process.argv[2] || "511568812872";
const SLUG = process.argv[3] || "s3-misconfiguration-audit";
const __dirname = dirname(fileURLToPath(import.meta.url));
const region = "us-east-1";

// Replicate labLearnerPolicy()'s merge (read repo-root lab.json + guardrail).
const lab = JSON.parse(readFileSync(join(__dirname, "..", "labs", SLUG, "lab.json"), "utf8"));
const guardrail = [
  { Sid: "ssGuardrailProtectControlPlane", Effect: "Deny", Action: ["iam:*", "sts:AssumeRole"],
    Resource: [`arn:aws:iam::${ACCOUNT}:role/ShieldSyncLab*`, `arn:aws:iam::${ACCOUNT}:role/OrganizationAccountAccessRole`] },
  { Sid: "ssGuardrailDenyGovernance", Effect: "Deny", Action: ["organizations:*", "account:*"], Resource: "*" },
];
const policy = JSON.stringify({ Version: "2012-10-17", Statement: [...lab.learnerPolicy, ...guardrail] });
console.log(`policy: ${policy.length} chars (limit 2048), lab=${SLUG}, account=${ACCOUNT}\n`);

const roleArn = `arn:aws:iam::${ACCOUNT}:role/ShieldSyncLabUser`;
const c = await assumeInSandbox(roleArn, "verify-leastpriv", 900, { policy });
const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };

let allPass = true;
async function probe(name, fn, expect) {
  try {
    await fn();
    const ok = expect === "allow";
    console.log(`${ok ? "✓" : "✗"} ${name}: ALLOWED ${ok ? "(expected)" : "← SHOULD BE DENIED"}`);
    allPass &&= ok;
  } catch (e) {
    const denied = /AccessDenied|not authorized|explicit deny/i.test(`${e.name} ${e.message}`);
    if (denied) {
      const ok = expect === "deny";
      console.log(`${ok ? "✓" : "✗"} ${name}: DENIED ${ok ? "(expected)" : "← SHOULD BE ALLOWED"} [${e.name}]`);
      allPass &&= ok;
    } else {
      console.log(`? ${name}: ERROR ${e.name}: ${e.message}`);
      allPass = false;
    }
  }
}

const sts = new STSClient({ region, credentials });
const ddb = new DynamoDBClient({ region, credentials });
const lambda = new LambdaClient({ region, credentials });
const iam = new IAMClient({ region, credentials });

// ALLOW (lab needs these) — note iam:ListUsers is granted but iam:ListRoles is NOT,
// proving the scoping is action-specific, not a blanket iam allow.
await probe("sts:GetCallerIdentity", () => sts.send(new GetCallerIdentityCommand({})), "allow");
await probe("iam:ListUsers", () => iam.send(new ListUsersCommand({})), "allow");
// DENY (unrelated services + un-granted IAM reads → not in the allow-list)
await probe("dynamodb:ListTables", () => ddb.send(new ListTablesCommand({})), "deny");
await probe("lambda:ListFunctions", () => lambda.send(new ListFunctionsCommand({})), "deny");
await probe("iam:ListRoles", () => iam.send(new ListRolesCommand({})), "deny");

console.log(`\n${allPass ? "LEAST-PRIV VERIFIED ✓ — session is scoped correctly" : "LEAST-PRIV FAILED ✗ — see mismatches above"}`);
process.exit(allPass ? 0 : 1);
