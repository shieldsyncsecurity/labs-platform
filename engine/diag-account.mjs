// Read-only diagnostic: why did a lab stack fail in a sandbox account?
// Assumes OrganizationAccountAccessRole (org master -> member) and prints:
//   - all stacks + status
//   - the FAILED events for a given stack (name or full ARN)
// Run: node diag-account.mjs <accountId> [<stackNameOrArn>]

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  CloudFormationClient,
  ListStacksCommand,
  DescribeStackEventsCommand,
} from "@aws-sdk/client-cloudformation";

const REGION = "us-east-1";
const accountId = process.argv[2];
const stackRef = process.argv[3];
if (!accountId) { console.error("usage: node diag-account.mjs <accountId> [stackNameOrArn]"); process.exit(1); }

const sts = new STSClient({ region: REGION });
const r = await sts.send(new AssumeRoleCommand({
  RoleArn: `arn:aws:iam::${accountId}:role/OrganizationAccountAccessRole`,
  RoleSessionName: "diag",
}));
const c = r.Credentials;
const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
const cfn = new CloudFormationClient({ region: REGION, credentials });

const ls = await cfn.send(new ListStacksCommand({
  StackStatusFilter: [
    "CREATE_COMPLETE", "CREATE_FAILED", "CREATE_IN_PROGRESS",
    "ROLLBACK_COMPLETE", "ROLLBACK_FAILED", "ROLLBACK_IN_PROGRESS",
    "DELETE_FAILED", "DELETE_IN_PROGRESS",
    "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE",
  ],
}));
console.log(`Stacks in ${accountId}:`);
for (const s of ls.StackSummaries ?? []) {
  console.log(`  ${(s.StackStatus || "").padEnd(22)} ${s.StackName}`);
}

if (stackRef) {
  console.log(`\nFAILED events for ${stackRef}:`);
  try {
    const ev = await cfn.send(new DescribeStackEventsCommand({ StackName: stackRef }));
    const fails = (ev.StackEvents ?? []).filter((e) => /FAILED/.test(e.ResourceStatus || ""));
    if (!fails.length) console.log("  (no FAILED events found)");
    for (const f of fails.reverse()) {
      console.log(`  ${f.LogicalResourceId} (${f.ResourceType}) ${f.ResourceStatus}`);
      console.log(`      ${f.ResourceStatusReason}`);
    }
  } catch (e) {
    console.log(`  could not read events: ${e.name}: ${e.message}`);
  }
}
