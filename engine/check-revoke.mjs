// Verify the teardown's "revoke learner console session" actually fired by
// checking each sandbox account for the ShieldSyncRevokeSessions inline policy
// on ShieldSyncLabUser. Prints the TokenIssueTime cutoff and when it was set.
//
// If the policy is present + recent: every federated console session minted
// BEFORE that timestamp will get AccessDenied on the next API call. ✓
// If the policy is missing: the revoke step didn't run (or silently failed).
//
//   node check-revoke.mjs

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  IAMClient,
  ListRolePoliciesCommand,
  GetRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";

async function assume(roleArn) {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: "check-revoke" })
  );
  const c = r.Credentials;
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

const pc = await assume(`arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`);
const dd = new DynamoDBClient({ region: REGION, credentials: pc });
const pool = (await dd.send(new ScanCommand({ TableName: "ShieldSyncLabAccounts" }))).Items ?? [];

console.log(`\nChecking ShieldSyncLabUser revoke policy on ${pool.length} sandbox account(s):\n`);

for (const a of pool) {
  const aid = a.accountId.S;
  console.log(`Account ${aid}  pool-status=${a.status?.S}`);
  try {
    const sc = await assume(`arn:aws:iam::${aid}:role/OrganizationAccountAccessRole`);
    const iam = new IAMClient({ region: REGION, credentials: sc });
    const list = await iam.send(
      new ListRolePoliciesCommand({ RoleName: "ShieldSyncLabUser" })
    );
    const names = list.PolicyNames ?? [];
    console.log(`  inline policies on ShieldSyncLabUser: [${names.join(", ") || "(none)"}]`);

    if (!names.includes("ShieldSyncRevokeSessions")) {
      console.log(`  ⚠ NO ShieldSyncRevokeSessions policy here.`);
      console.log(`     -> If a lab was torn down on this account, the revoke step DID NOT fire.`);
      console.log(`     -> Any federated console URL minted before teardown is still live.\n`);
      continue;
    }

    const got = await iam.send(
      new GetRolePolicyCommand({
        RoleName: "ShieldSyncLabUser",
        PolicyName: "ShieldSyncRevokeSessions",
      })
    );
    const doc = JSON.parse(decodeURIComponent(got.PolicyDocument));
    const cutoff = doc.Statement?.[0]?.Condition?.DateLessThan?.["aws:TokenIssueTime"];
    const ageMin = cutoff
      ? Math.round((Date.now() - new Date(cutoff).getTime()) / 60000)
      : null;
    console.log(`  ShieldSyncRevokeSessions:  Deny *  if  aws:TokenIssueTime < ${cutoff}`);
    console.log(`     (set ${ageMin} min ago)`);
    console.log(`  ✓ Every console session minted BEFORE that timestamp is now denied.\n`);
  } catch (e) {
    console.log(`  error: ${e.name}: ${e.message}\n`);
  }
}
