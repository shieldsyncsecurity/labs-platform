// Read-only audit of the labs platform infrastructure. Flags anything that
// doesn't match the expected baseline (orphan resources, leftover users in
// sandboxes, old deploy artifacts, etc.). NEVER deletes anything — prints
// findings and you decide.
//
//   node audit-cruft.mjs

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient, ListTablesCommand, ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { ApiGatewayV2Client, GetApisCommand } from "@aws-sdk/client-apigatewayv2";
import { EventBridgeClient, ListRulesCommand } from "@aws-sdk/client-eventbridge";
import { S3Client, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { IAMClient, ListRolesCommand, ListUsersCommand } from "@aws-sdk/client-iam";
import { CloudFormationClient, ListStacksCommand } from "@aws-sdk/client-cloudformation";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const DEPLOY_BUCKET = "shieldsync-engine-deploy-750294427884";

const EXPECTED = {
  ddbTables: ["ShieldSyncLabAccounts", "ShieldSyncLabSessions", "ShieldSyncLabUsers", "ShieldSyncLabEntitlements", "ShieldSyncLabRatings"],
  lambdas: ["ShieldSyncEngine"],
  ebRules: ["ShieldSyncReaper", "ShieldSyncWarmer"],
  rolesPlatform: ["ShieldSyncEngineRole", "OrganizationAccountAccessRole"],
  rolesSandbox: ["ShieldSyncLabExec", "ShieldSyncLabUser", "OrganizationAccountAccessRole"],
};

async function assume(roleArn) {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "audit-cruft" }));
  const c = r.Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

const findings = [];
function flag(sev, where, msg) {
  findings.push({ sev, where, msg });
  const tag = sev === "high" ? "🚨" : sev === "med" ? "⚠️ " : "ℹ️ ";
  console.log(`${tag} [${where}] ${msg}`);
}

function isCustomRole(r) {
  return !r.Path?.startsWith("/aws-service-role/") && !r.RoleName.startsWith("AWSServiceRoleFor");
}

// ─── PLATFORM (750) ─────────────────────────────────────────────────────────
console.log("\n=== PLATFORM (750294427884) ===");
const pc = await assume(`arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`);

const dd = new DynamoDBClient({ region: REGION, credentials: pc });
const tables = (await dd.send(new ListTablesCommand({}))).TableNames ?? [];
console.log(`DynamoDB tables (${tables.length}):`);
for (const t of tables) console.log(`  ${EXPECTED.ddbTables.includes(t) ? "✓" : "?"} ${t}`);
const xDDB = tables.filter((t) => !EXPECTED.ddbTables.includes(t));
if (xDDB.length) flag("med", "DDB", `unexpected: ${xDDB.join(", ")}`);
const missDDB = EXPECTED.ddbTables.filter((t) => !tables.includes(t));
if (missDDB.length) flag("high", "DDB", `MISSING: ${missDDB.join(", ")}`);

const lc = new LambdaClient({ region: REGION, credentials: pc });
const fns = (await lc.send(new ListFunctionsCommand({}))).Functions ?? [];
console.log(`\nLambda (${fns.length}):`);
for (const f of fns) console.log(`  ${EXPECTED.lambdas.includes(f.FunctionName) ? "✓" : "?"} ${f.FunctionName} (${f.Runtime})`);
const xFn = fns.filter((f) => !EXPECTED.lambdas.includes(f.FunctionName));
if (xFn.length) flag("med", "Lambda", `unexpected: ${xFn.map((f) => f.FunctionName).join(", ")}`);

const apic = new ApiGatewayV2Client({ region: REGION, credentials: pc });
const apis = (await apic.send(new GetApisCommand({}))).Items ?? [];
console.log(`\nHTTP APIs (${apis.length}):`);
for (const a of apis) console.log(`  ${a.ApiId} ${a.Name}`);
if (apis.length > 1) flag("med", "ApiGW", `multiple HTTP APIs — only lewssnjjhi expected`);

const ebc = new EventBridgeClient({ region: REGION, credentials: pc });
const rules = (await ebc.send(new ListRulesCommand({}))).Rules ?? [];
console.log(`\nEventBridge rules (${rules.length}):`);
for (const r of rules) console.log(`  ${EXPECTED.ebRules.includes(r.Name) ? "✓" : "?"} ${r.Name} ${r.State} ${r.ScheduleExpression ?? ""}`);
const xRules = rules.filter((r) => !EXPECTED.ebRules.includes(r.Name));
if (xRules.length) flag("med", "EB", `unexpected rule(s): ${xRules.map((r) => r.Name).join(", ")}`);

const s3 = new S3Client({ region: REGION, credentials: pc });
try {
  const v = await s3.send(new ListObjectVersionsCommand({ Bucket: DEPLOY_BUCKET, Prefix: "engine.zip" }));
  const versions = (v.Versions ?? []).length;
  const markers = (v.DeleteMarkers ?? []).length;
  console.log(`\nDeploy bucket engine.zip versions: ${versions} (delete markers: ${markers})`);
  if (versions > 5) flag("low", "S3", `${versions} old engine.zip versions — clean to save storage`);
} catch (e) { console.log(`Deploy bucket: ${e.message}`); }

const iam = new IAMClient({ region: REGION, credentials: pc });
const roles = (await iam.send(new ListRolesCommand({}))).Roles ?? [];
const custom = roles.filter(isCustomRole);
console.log(`\nIAM custom roles (${custom.length}):`);
for (const r of custom) console.log(`  ${EXPECTED.rolesPlatform.includes(r.RoleName) ? "✓" : "?"} ${r.RoleName}`);
const xRoles = custom.filter((r) => !EXPECTED.rolesPlatform.includes(r.RoleName));
if (xRoles.length) flag("med", "IAM", `unexpected role(s): ${xRoles.map((r) => r.RoleName).join(", ")}`);

// ─── SANDBOX ACCOUNTS ──────────────────────────────────────────────────────
console.log("\n=== SANDBOX ACCOUNTS ===");
const pool = (await dd.send(new ScanCommand({ TableName: "ShieldSyncLabAccounts" }))).Items ?? [];
for (const a of pool) {
  const aid = a.accountId.S;
  const status = a.status?.S;
  console.log(`\n${aid}  pool-status=${status}`);
  try {
    const sc = await assume(`arn:aws:iam::${aid}:role/OrganizationAccountAccessRole`);

    const cfn = new CloudFormationClient({ region: REGION, credentials: sc });
    const stacks = (await cfn.send(new ListStacksCommand({
      StackStatusFilter: ["CREATE_COMPLETE", "CREATE_FAILED", "CREATE_IN_PROGRESS", "ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "UPDATE_COMPLETE"],
    }))).StackSummaries ?? [];
    console.log(`  CFN stacks: ${stacks.length}`);
    for (const s of stacks) console.log(`    ${s.StackName} ${s.StackStatus}`);
    // available + 0 stacks = clean. available + 1 warm stack = fine. anything else = suspicious.
    if (status === "available" && stacks.length > 1) flag("med", aid, `${stacks.length} stacks while available — only 0-1 (warm) expected`);
    const failed = stacks.filter((s) => s.StackStatus.includes("FAILED") || s.StackStatus.includes("ROLLBACK"));
    if (failed.length) flag("high", aid, `${failed.length} failed/rolled-back stack(s) lingering`);

    const sIam = new IAMClient({ region: REGION, credentials: sc });
    const users = (await sIam.send(new ListUsersCommand({}))).Users ?? [];
    console.log(`  IAM users: ${users.length}${users.length ? "  (" + users.map((u) => u.UserName).join(", ") + ")" : ""}`);
    if (users.length > 0 && status === "available") flag("high", aid, `${users.length} IAM user(s) leftover in 'available' account — should be 0 between sessions`);

    const sRoles = (await sIam.send(new ListRolesCommand({}))).Roles ?? [];
    const sCustom = sRoles.filter(isCustomRole);
    const xSRoles = sCustom.filter((r) => !EXPECTED.rolesSandbox.includes(r.RoleName));
    if (xSRoles.length) {
      console.log(`  extra IAM roles: ${xSRoles.map((r) => r.RoleName).join(", ")}`);
      flag("med", aid, `extra IAM role(s): ${xSRoles.map((r) => r.RoleName).join(", ")}`);
    } else {
      console.log(`  IAM roles: ✓ control roles only`);
    }
  } catch (e) {
    console.log(`  error: ${e.name}: ${e.message}`);
  }
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────
console.log("\n\n=== SUMMARY ===");
if (findings.length === 0) {
  console.log("✅ No cruft found — infrastructure matches the expected baseline.");
} else {
  const by = { high: 0, med: 0, low: 0 };
  for (const f of findings) by[f.sev]++;
  console.log(`${findings.length} finding(s):  🚨 high: ${by.high}   ⚠️  med: ${by.med}   ℹ️  low: ${by.low}`);
  console.log("\n(Nothing was deleted — review each finding and act manually.)");
}
