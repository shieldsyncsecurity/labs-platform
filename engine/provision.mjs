// ShieldSync Labs — baseline automation: vend + stamp a new sandbox account,
// then register it in the pool. Runs from the MANAGEMENT account.
//
// ORDER MATTERS: create -> baseline WHILE IN ROOT (no SCPs) -> move to the
// Available OU -> register. Baselining inside the Sandbox OU would be blocked
// by the ProtectGovernance SCP (it denies AttachRolePolicy on ShieldSyncLabExec).
//
// Split into create + baselineAndRegister() so a half-built account can be
// finished without re-creating it (CreateAccount is semi-permanent).

import { OrganizationsClient, CreateAccountCommand, DescribeCreateAccountStatusCommand, ListParentsCommand, MoveAccountCommand } from "@aws-sdk/client-organizations";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, CreateAccountAliasCommand } from "@aws-sdk/client-iam";
import { S3ControlClient, PutPublicAccessBlockCommand } from "@aws-sdk/client-s3-control";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { BudgetsClient, CreateBudgetCommand } from "@aws-sdk/client-budgets";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";
const AVAILABLE_OU = "ou-uqhk-ymcvuyrv";
const ACCOUNTS_TABLE = "ShieldSyncLabAccounts";
const MGMT_ACCOUNT = "851236938541";
const BUDGET_EMAIL = "info@shieldsyncsecurity.com";
const ADMIN_POLICY = "arn:aws:iam::aws:policy/AdministratorAccess";
const CONTROL_ROLES = ["ShieldSyncLabExec", "ShieldSyncLabUser"];
const TRUST_PLATFORM = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Principal: { AWS: `arn:aws:iam::${PLATFORM_ACCOUNT}:root` }, Action: "sts:AssumeRole" }],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry transient new-account errors (S3/services take minutes to "sign up").
async function withRetry(label, fn, attempts = 12, delayMs = 20000) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const transient = ["NotSignedUp", "OptInRequired", "Throttling", "ThrottlingException", "TooManyRequestsException"].includes(e.name) || /throttl/i.test(e.name || "");
      if (i === attempts - 1 || !transient) throw e;
      console.log(`  (${label}: ${e.name} — retrying in ${delayMs / 1000}s, ${i + 1}/${attempts})`);
      await sleep(delayMs);
    }
  }
}

async function assume(roleArn, name, attempts = 1) {
  const sts = new STSClient({ region: REGION });
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: name }));
      const c = r.Credentials;
      return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
    } catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(5000);
    }
  }
}

/** baselineAndRegister(): finish setup for an existing (Root-resident) account. */
export async function baselineAndRegister(accountId, alias) {
  const org = new OrganizationsClient({ region: REGION });
  const nc = await assume(`arn:aws:iam::${accountId}:role/OrganizationAccountAccessRole`, "provision-baseline", 6);
  const iam = new IAMClient({ region: REGION, credentials: nc });

  // Control roles (idempotent). MUST happen while still in Root (no SCP).
  for (const roleName of CONTROL_ROLES) {
    try {
      await iam.send(new CreateRoleCommand({
        RoleName: roleName,
        AssumeRolePolicyDocument: TRUST_PLATFORM,
        MaxSessionDuration: 3600,
        Description: "ShieldSync control role (engine deploy/teardown + learner console)",
      }));
    } catch (e) { if (!/EntityAlreadyExists/.test(e.name || e.Code || "")) throw e; }
    await iam.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: ADMIN_POLICY }));
  }
  console.log(`  -> roles ready (${CONTROL_ROLES.join(" + ")})`);

  // account-level BPA OFF (retry: new accounts aren't signed up for S3 instantly)
  const s3c = new S3ControlClient({ region: REGION, credentials: nc });
  await withRetry("BPA", () => s3c.send(new PutPublicAccessBlockCommand({
    AccountId: accountId,
    PublicAccessBlockConfiguration: { BlockPublicAcls: false, IgnorePublicAcls: false, BlockPublicPolicy: false, RestrictPublicBuckets: false },
  })));
  console.log(`  -> account BPA disabled`);

  // IAM account alias (aws-nuke safety gate)
  try { await iam.send(new CreateAccountAliasCommand({ AccountAlias: alias })); } catch (e) { console.log(`  (alias: ${e.name})`); }
  console.log(`  -> alias ${alias}`);

  // move into the guarded Available OU (only after baseline)
  const parent = (await org.send(new ListParentsCommand({ ChildId: accountId }))).Parents[0].Id;
  if (parent !== AVAILABLE_OU) {
    await org.send(new MoveAccountCommand({ AccountId: accountId, SourceParentId: parent, DestinationParentId: AVAILABLE_OU }));
    console.log(`  -> moved to Available OU`);
  } else {
    console.log(`  -> already in Available OU`);
  }

  // register in the pool (DynamoDB, in the platform account)
  const pc = await assume(`arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`, "provision-ddb");
  const db = new DynamoDBClient({ region: REGION, credentials: pc });
  await db.send(new PutItemCommand({
    TableName: ACCOUNTS_TABLE,
    Item: {
      accountId: { S: accountId },
      status: { S: "available" },
      execRoleArn: { S: `arn:aws:iam::${accountId}:role/ShieldSyncLabExec` },
      alias: { S: alias },
      registeredAt: { S: new Date().toISOString() },
    },
  }));
  console.log(`  -> registered in pool as available`);

  // Cost guardrail: per-sandbox budget in the MANAGEMENT account — lives outside
  // the sandbox, so it survives aws-nuke. Alerts at 80% of $10/mo. (CloudTrail is
  // a one-time org-wide trail in management that auto-covers every new account,
  // so there's nothing CloudTrail-related to do per-account here.)
  try {
    const budgets = new BudgetsClient({ region: REGION }); // default creds = management
    await budgets.send(
      new CreateBudgetCommand({
        AccountId: MGMT_ACCOUNT,
        Budget: {
          BudgetName: `sandbox-${accountId}-monthly`,
          BudgetLimit: { Amount: "10", Unit: "USD" },
          TimeUnit: "MONTHLY",
          BudgetType: "COST",
          CostFilters: { LinkedAccount: [accountId] },
        },
        NotificationsWithSubscribers: [
          {
            Notification: { NotificationType: "ACTUAL", ComparisonOperator: "GREATER_THAN", Threshold: 80, ThresholdType: "PERCENTAGE" },
            Subscribers: [{ SubscriptionType: "EMAIL", Address: BUDGET_EMAIL }],
          },
        ],
      })
    );
    console.log(`  -> budget created ($10/mo, alert → ${BUDGET_EMAIL})`);
  } catch (e) {
    if (/DuplicateRecord/i.test(e.name || "")) console.log("  -> budget already exists");
    else console.log(`  (budget note: ${e.name})`);
  }

  return { accountId, alias };
}

/** provisionSandboxAccount(): create a new account, then baseline + register it. */
export async function provisionSandboxAccount({ name, email, alias }) {
  const org = new OrganizationsClient({ region: REGION });
  console.log(`  creating account "${name}" <${email}> ...`);
  const car = await org.send(new CreateAccountCommand({ AccountName: name, Email: email }));
  const reqId = car.CreateAccountStatus.Id;
  let accountId;
  for (let i = 0; i < 60; i++) {
    const st = (await org.send(new DescribeCreateAccountStatusCommand({ CreateAccountRequestId: reqId }))).CreateAccountStatus;
    if (st.State === "SUCCEEDED") { accountId = st.AccountId; break; }
    if (st.State === "FAILED") throw new Error("CreateAccount FAILED: " + st.FailureReason);
    await sleep(5000);
  }
  if (!accountId) throw new Error("CreateAccount timed out");
  console.log(`  -> account ${accountId}`);
  return baselineAndRegister(accountId, alias);
}
