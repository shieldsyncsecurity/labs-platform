// Read-only: full pool picture. Accounts (status + warm markers), recent
// sessions, and stack counts per account. Run: node pool-status.mjs

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { CloudFormationClient, ListStacksCommand } from "@aws-sdk/client-cloudformation";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";
const ACCOUNTS_TABLE = "ShieldSyncLabAccounts";
const SESSIONS_TABLE = "ShieldSyncLabSessions";

async function assume(roleArn, base) {
  const sts = new STSClient({ region: REGION, credentials: base });
  const r = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "poolstatus", DurationSeconds: 3600 }));
  const c = r.Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

const pc = await assume(`arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`);
const db = new DynamoDBClient({ region: REGION, credentials: pc });

const acc = await db.send(new ScanCommand({ TableName: ACCOUNTS_TABLE }));
console.log("=== ACCOUNTS ===");
const accounts = [];
for (const a of acc.Items ?? []) {
  const id = a.accountId.S;
  accounts.push(id);
  console.log(`  ${id}  status=${a.status?.S}  warmLab=${a.warmLab?.S ?? "-"}  warmReady=${a.warmReady?.BOOL ?? "-"}  session=${a.currentSessionId?.S ?? "-"}`);
}

const ses = await db.send(new ScanCommand({ TableName: SESSIONS_TABLE }));
const now = Date.now();
const items = (ses.Items ?? []).sort((a, b) => ((a.startedAt?.S ?? "") < (b.startedAt?.S ?? "") ? 1 : -1));
console.log(`\n=== SESSIONS (${items.length} total, newest 12) ===`);
for (const s of items.slice(0, 12)) {
  const exp = s.expiresAt?.S ? (new Date(s.expiresAt.S).getTime() > now ? "LIVE" : "expired") : "-";
  console.log(`  ${s.status?.S?.padEnd(8)} ${exp.padEnd(7)} lab=${s.labSlug?.S} acct=${s.accountId?.S} ${s.sessionId.S}`);
}

console.log("\n=== STACKS PER ACCOUNT ===");
for (const id of accounts) {
  try {
    const creds = await assume(`arn:aws:iam::${id}:role/OrganizationAccountAccessRole`);
    const cfn = new CloudFormationClient({ region: REGION, credentials: creds });
    const ls = await cfn.send(new ListStacksCommand({ StackStatusFilter: [
      "CREATE_COMPLETE", "CREATE_FAILED", "CREATE_IN_PROGRESS", "ROLLBACK_COMPLETE",
      "ROLLBACK_FAILED", "DELETE_FAILED", "DELETE_IN_PROGRESS", "UPDATE_COMPLETE",
    ] }));
    const ss = ls.StackSummaries ?? [];
    const byStatus = {};
    for (const s of ss) byStatus[s.StackStatus] = (byStatus[s.StackStatus] || 0) + 1;
    console.log(`  ${id}: ${ss.length} stacks ${JSON.stringify(byStatus)}`);
  } catch (e) {
    console.log(`  ${id}: error ${e.name}: ${e.message}`);
  }
}
