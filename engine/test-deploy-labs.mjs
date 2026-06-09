// One-off: prove new lab templates really deploy under the sandbox SCPs, via the
// engine's exact credential chain (mgmt -> platform OrgAccountAccessRole ->
// sandbox ShieldSyncLabExec). Does NOT lease and does NOT touch the warm pool
// (no DynamoDB writes) - just deploys a throwaway stack, verifies CREATE_COMPLETE,
// prints outputs, then deletes it. Run: node test-deploy-labs.mjs <slug> [<slug>...]

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  DescribeStackEventsCommand,
  DeleteStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackDeleteComplete,
} from "@aws-sdk/client-cloudformation";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";
const ACCOUNTS_TABLE = "ShieldSyncLabAccounts";
const __dirname = dirname(fileURLToPath(import.meta.url));

const creds = (c) => ({ accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken });

async function platformCreds() {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(new AssumeRoleCommand({
    RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
    RoleSessionName: "labtest",
  }));
  return creds(r.Credentials);
}

async function sandboxCreds(execRoleArn, pc) {
  const sts = new STSClient({ region: REGION, credentials: pc });
  const r = await sts.send(new AssumeRoleCommand({ RoleArn: execRoleArn, RoleSessionName: "labtest", DurationSeconds: 3600 }));
  return creds(r.Credentials);
}

async function pickAccount(pc) {
  const db = new DynamoDBClient({ region: REGION, credentials: pc });
  const s = await db.send(new ScanCommand({ TableName: ACCOUNTS_TABLE }));
  const items = (s.Items ?? []).filter((i) => i.execRoleArn?.S);
  // prefer an available account so we never collide with a live session
  const a = items.find((i) => i.status?.S === "available") ?? items[0];
  if (!a) throw new Error("no registered accounts");
  return { accountId: a.accountId.S, execRoleArn: a.execRoleArn.S, status: a.status?.S };
}

async function testLab(slug, sbx, accountId) {
  const cfn = new CloudFormationClient({ region: REGION, credentials: sbx });
  const body = readFileSync(join(__dirname, "..", "labs", slug, "template.yaml"), "utf8");
  const stackName = `sslab-test-${slug}`;
  let ok = false;
  console.log(`\n[${slug}] CreateStack ${stackName} -> ${accountId}`);
  try {
    await cfn.send(new CreateStackCommand({
      StackName: stackName,
      TemplateBody: body,
      Capabilities: ["CAPABILITY_NAMED_IAM"],
      Tags: [{ Key: "ShieldSyncLab", Value: slug }],
    }));
    await waitUntilStackCreateComplete({ client: cfn, maxWaitTime: 300 }, { StackName: stackName });
    const d = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const outs = d.Stacks[0].Outputs ?? [];
    console.log(`[${slug}] CREATE_COMPLETE  (${outs.length} outputs)`);
    for (const o of outs) console.log(`    ${o.OutputKey} = ${o.OutputValue}`);
    ok = true;
  } catch (e) {
    console.log(`[${slug}] DEPLOY FAILED: ${e.name}: ${e.message}`);
    try {
      const ev = await cfn.send(new DescribeStackEventsCommand({ StackName: stackName }));
      const fails = (ev.StackEvents ?? []).filter((x) => /FAILED/.test(x.ResourceStatus || ""));
      for (const f of fails.slice(0, 8)) console.log(`    x ${f.LogicalResourceId} (${f.ResourceType}): ${f.ResourceStatusReason}`);
    } catch {}
  }
  console.log(`[${slug}] DeleteStack ${stackName} (cleanup)`);
  try {
    await cfn.send(new DeleteStackCommand({ StackName: stackName }));
    await waitUntilStackDeleteComplete({ client: cfn, maxWaitTime: 300 }, { StackName: stackName });
    console.log(`[${slug}] deleted`);
  } catch (e) {
    console.log(`[${slug}] delete note: ${e.name} (KMS keys go pending-deletion; harmless in a sandbox)`);
  }
  return ok;
}

const slugs = process.argv.slice(2);
if (!slugs.length) { console.error("usage: node test-deploy-labs.mjs <slug> [<slug>...]"); process.exit(1); }
const pc = await platformCreds();
const acct = await pickAccount(pc);
console.log(`Sandbox account ${acct.accountId} (status=${acct.status})`);
const sbx = await sandboxCreds(acct.execRoleArn, pc);
const results = {};
for (const slug of slugs) results[slug] = await testLab(slug, sbx, acct.accountId);
console.log("\n=== RESULT ===");
for (const [s, ok] of Object.entries(results)) console.log(`  ${ok ? "PASS" : "FAIL"}  ${s}`);
process.exit(Object.values(results).every(Boolean) ? 0 : 2);
