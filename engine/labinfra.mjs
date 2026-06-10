// ShieldSync Labs — Session Engine: LabInfra (real AWS implementation).
//
// lease(), deployLab(), mintConsoleUrl(), teardown() (aws-nuke), reap().
//
// Local-dev: management CLI creds -> assume PLATFORM account (DynamoDB) -> chain
// into a leased SANDBOX account via the lab roles. In prod this is a Lambda in
// the platform account; the first hop disappears.

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  waitUntilStackCreateComplete,
} from "@aws-sdk/client-cloudformation";
import { IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const REGION = "us-east-1";
const MGMT_ACCOUNT = "851236938541";
const PLATFORM_ACCOUNT = "750294427884";
const ACCOUNTS_TABLE = "ShieldSyncLabAccounts";
const SESSIONS_TABLE = "ShieldSyncLabSessions";
const USERS_TABLE = "ShieldSyncLabUsers";
const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// Per-account aws-nuke config, generated at teardown so it works for ANY pool
// account. Preserves the control roles; blocklists mgmt + platform; allowlists
// only the one account being torn down (extra safety).
function nukeConfigFor(accountId) {
  return `regions:
  - global
  - us-east-1
account-blocklist:
  - "${MGMT_ACCOUNT}"
  - "${PLATFORM_ACCOUNT}"
accounts:
  "${accountId}":
    presets:
      - control-plane
presets:
  control-plane:
    filters:
      IAMRole:
        - "OrganizationAccountAccessRole"
        - "ShieldSyncLabExec"
        - "ShieldSyncLabUser"
      IAMRolePolicyAttachment:
        - property: RoleName
          value: "OrganizationAccountAccessRole"
        - property: RoleName
          value: "ShieldSyncLabExec"
        - property: RoleName
          value: "ShieldSyncLabUser"
      IAMRolePolicy:
        - property: RoleName
          value: "OrganizationAccountAccessRole"
        - property: RoleName
          value: "ShieldSyncLabExec"
        - property: RoleName
          value: "ShieldSyncLabUser"
      CloudTrailTrail:
        - "ShieldSyncOrgTrail"
`;
}

// --- credential bridges (local dev only) ---
let _pc;
async function platformCreds() {
  if (_pc && _pc.exp > Date.now() + 60000) return _pc.creds;
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "engine-local",
    })
  );
  const c = r.Credentials;
  _pc = {
    creds: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
    exp: new Date(c.Expiration).getTime(),
  };
  return _pc.creds;
}

async function assumeInSandbox(roleArn, sessionName, durationSeconds) {
  // Lambda runs in the platform account — use execution role directly.
  // Local dev assumes into the platform account first via platformCreds().
  const sts = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? new STSClient({ region: REGION })
    : new STSClient({ region: REGION, credentials: await platformCreds() });
  const r = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: sessionName, DurationSeconds: durationSeconds })
  );
  return r.Credentials;
}

let _ddb;
async function ddb() {
  if (_ddb) return _ddb;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Lambda: execution role provides credentials — no STS bridge needed.
    _ddb = new DynamoDBClient({ region: REGION });
  } else {
    // Local dev: pass platformCreds as a live provider so the SDK re-evaluates
    // on each call — our cache + refresh means it only hits STS when near expiry.
    _ddb = new DynamoDBClient({ region: REGION, credentials: platformCreds });
  }
  return _ddb;
}

function rid(n = 10) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/**
 * lease(): atomically claim an available account; stamp an expiry window.
 * Prefers an account already PRE-WARMED with this lab -> the session is born
 * "active" (instant start, no deploy). Otherwise claims a cold account ->
 * "leasing" and the caller deploys in the background.
 */
export async function lease(userId, labSlug, windowMinutes = 30) {
  const db = await ddb();
  const sessionId = "sess_" + rid();
  const now = Date.now();
  const expiresAt = new Date(now + windowMinutes * 60000).toISOString();

  const scan = await db.send(
    new ScanCommand({
      TableName: ACCOUNTS_TABLE,
      FilterExpression: "#s = :avail",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":avail": { S: "available" } },
    })
  );
  const avail = scan.Items ?? [];
  const isWarmFor = (a) => a.warmLab?.S === labSlug && a.warmReady?.BOOL === true;
  // warmed-for-this-lab accounts first
  const ordered = [...avail.filter(isWarmFor), ...avail.filter((a) => !isWarmFor(a))];

  for (const acct of ordered) {
    const accountId = acct.accountId.S;
    const warm = isWarmFor(acct);
    try {
      await db.send(
        new UpdateItemCommand({
          TableName: ACCOUNTS_TABLE,
          Key: { accountId: { S: accountId } },
          UpdateExpression: "SET #s = :leased, currentSessionId = :sid",
          ConditionExpression: "#s = :avail",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":leased": { S: "leased" }, ":avail": { S: "available" }, ":sid": { S: sessionId } },
        })
      );
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") continue;
      throw e;
    }

    const item = {
      sessionId: { S: sessionId },
      userId: { S: userId },
      labSlug: { S: labSlug },
      accountId: { S: accountId },
      status: { S: warm ? "active" : "leasing" },
      startedAt: { S: new Date(now).toISOString() },
      expiresAt: { S: expiresAt },
    };
    if (warm && acct.warmStackName?.S) item.stackName = { S: acct.warmStackName.S };
    await db.send(new PutItemCommand({ TableName: SESSIONS_TABLE, Item: item }));
    return { sessionId, accountId, execRoleArn: acct.execRoleArn?.S, expiresAt, warm };
  }
  throw new Error("NO_CAPACITY");
}

/**
 * findActiveSession(): the user's current live (active, non-expired) session, if
 * any. Used to make launch idempotent — one active lab per learner — so a page
 * reload reconnects to the running lab instead of leasing another account.
 */
export async function findActiveSession(userId) {
  const db = await ddb();
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "userId = :u AND (#s = :active OR #s = :leasing) AND attribute_exists(expiresAt)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":u": { S: userId }, ":active": { S: "active" }, ":leasing": { S: "leasing" } },
    })
  );
  const now = Date.now();
  const live = (scan.Items ?? [])
    .filter((it) => new Date(it.expiresAt.S).getTime() > now)
    .sort((a, b) => (a.startedAt.S < b.startedAt.S ? 1 : -1));
  if (!live.length) return null;
  const it = live[0];
  return { sessionId: it.sessionId.S, accountId: it.accountId.S, labSlug: it.labSlug.S, expiresAt: it.expiresAt.S };
}

/** getSession(): the session record — the single source of truth the UI polls. */
export async function getSession(sessionId) {
  const db = await ddb();
  const s = await db.send(new GetItemCommand({ TableName: SESSIONS_TABLE, Key: { sessionId: { S: sessionId } } }));
  if (!s.Item) return null;
  const it = s.Item;
  return {
    sessionId,
    status: it.status?.S ?? "unknown",
    labSlug: it.labSlug?.S,
    accountId: it.accountId?.S,
    expiresAt: it.expiresAt?.S,
    error: it.error?.S,
  };
}

/** markSession(): set a session's status (+ optional error message). */
export async function markSession(sessionId, status, error) {
  const db = await ddb();
  const names = { "#s": "status" };
  const values = { ":s": { S: status } };
  let expr = "SET #s = :s";
  if (error) {
    names["#e"] = "error";
    values[":e"] = { S: String(error).slice(0, 400) };
    expr += ", #e = :e";
  }
  await db.send(
    new UpdateItemCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: { S: sessionId } },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

/** deployStack(): assume ShieldSyncLabExec and create a lab's CloudFormation. */
async function deployStack(execRoleArn, labSlug, stackName, tags = []) {
  const templatePath = join(__dirname, "labs", labSlug, "template.yaml");
  const templateBody = readFileSync(templatePath, "utf8");
  const c = await assumeInSandbox(execRoleArn, "engine-deploy");
  const cfn = new CloudFormationClient({
    region: REGION,
    credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
  });
  await cfn.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ["CAPABILITY_NAMED_IAM"],
      OnFailure: "DO_NOTHING",
      Tags: tags,
    })
  );
  await waitUntilStackCreateComplete({ client: cfn, maxWaitTime: 280 }, { StackName: stackName });
  const desc = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs = {};
  for (const o of desc.Stacks?.[0]?.Outputs ?? []) outputs[o.OutputKey] = o.OutputValue;
  return { stackName, outputs };
}

/** deployLab(): COLD lease — deploy, then flip the session to "active". */
export async function deployLab({ sessionId, accountId, labSlug, execRoleArn }) {
  const stackName = ("sslab-" + labSlug + "-" + sessionId.replace("sess_", "")).slice(0, 120);
  console.log(`  deploying stack ${stackName} into account ${accountId} ...`);
  const { outputs } = await deployStack(execRoleArn, labSlug, stackName, [{ Key: "ShieldSyncSession", Value: sessionId }]);
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: { S: sessionId } },
      UpdateExpression: "SET #s = :active, stackName = :sn",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": { S: "active" }, ":sn": { S: stackName } },
    })
  );
  return { stackName, outputs };
}

/**
 * warmAccount(): pre-deploy a lab into an available account so a future lease is
 * INSTANT. Atomically flips it to "warming" first (so it can't be leased mid-
 * deploy), then back to "available" + warm markers when ready.
 */
export async function warmAccount(accountId, execRoleArn, labSlug) {
  const db = await ddb();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: ACCOUNTS_TABLE,
        Key: { accountId: { S: accountId } },
        UpdateExpression: "SET #s = :warming",
        ConditionExpression: "#s = :avail",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":warming": { S: "warming" }, ":avail": { S: "available" } },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null; // not available right now
    throw e;
  }
  const stackName = ("sslab-" + labSlug + "-warm-" + accountId.slice(-6)).slice(0, 120);
  try {
    console.log(`  warming ${accountId} with ${labSlug} ...`);
    await deployStack(execRoleArn, labSlug, stackName, [{ Key: "ShieldSyncWarm", Value: labSlug }]);
  } catch (e) {
    await db
      .send(
        new UpdateItemCommand({
          TableName: ACCOUNTS_TABLE,
          Key: { accountId: { S: accountId } },
          UpdateExpression: "SET #s = :avail",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: { ":avail": { S: "available" } },
        })
      )
      .catch(() => {});
    throw e;
  }
  await db.send(
    new UpdateItemCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { accountId: { S: accountId } },
      UpdateExpression: "SET #s = :avail, warmLab = :l, warmStackName = :sn, warmReady = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":avail": { S: "available" }, ":l": { S: labSlug }, ":sn": { S: stackName }, ":t": { BOOL: true } },
    })
  );
  console.log(`  warmed ${accountId}`);
  return { accountId, stackName };
}

/** ensureWarm(): pre-warm every available account for labSlug (idempotent). */
export async function ensureWarm(labSlug) {
  const db = await ddb();
  const scan = await db.send(
    new ScanCommand({
      TableName: ACCOUNTS_TABLE,
      FilterExpression: "#s = :avail",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":avail": { S: "available" } },
    })
  );
  const toWarm = (scan.Items ?? []).filter((a) => !(a.warmLab?.S === labSlug && a.warmReady?.BOOL === true));
  const warmed = [];
  for (const a of toWarm) {
    try {
      const r = await warmAccount(a.accountId.S, a.execRoleArn?.S, labSlug);
      if (r) warmed.push(a.accountId.S);
    } catch (e) {
      console.log(`  warm failed ${a.accountId.S}: ${e.message}`);
    }
  }
  return warmed;
}

/** mintConsoleUrl(): scoped learner role -> AWS federation -> console sign-in URL. */
export async function mintConsoleUrl({ accountId, destination, durationSeconds = 1800 }) {
  const learnerRoleArn = `arn:aws:iam::${accountId}:role/ShieldSyncLabUser`;
  const c = await assumeInSandbox(learnerRoleArn, "lab-learner", durationSeconds);
  const session = JSON.stringify({
    sessionId: c.AccessKeyId,
    sessionKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  });
  const tokenResp = await fetch(
    `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${encodeURIComponent(session)}`
  );
  const { SigninToken } = await tokenResp.json();
  const dest = destination || `https://${REGION}.console.aws.amazon.com/s3/home?region=${REGION}`;
  const consoleUrl =
    `https://signin.aws.amazon.com/federation?Action=login` +
    `&Issuer=${encodeURIComponent("https://labs.shieldsyncsecurity.com")}` +
    `&Destination=${encodeURIComponent(dest)}` +
    `&SigninToken=${SigninToken}`;
  return { consoleUrl, expiresInSeconds: durationSeconds };
}

/**
 * teardown(): FULL WIPE via aws-nuke (removes everything the learner created,
 * incl. out-of-band resources delete-stack would miss, preserving the control
 * roles), then return the account to the pool. Generates a per-account nuke
 * config on the fly. Lambda: ship the linux aws-nuke binary.
 */
export async function teardown(sessionId) {
  const db = await ddb();
  const s = await db.send(new GetItemCommand({ TableName: SESSIONS_TABLE, Key: { sessionId: { S: sessionId } } }));
  if (!s.Item) throw new Error("session not found");
  const accountId = s.Item.accountId.S;
  await markSession(sessionId, "ending").catch(() => {});

  const a = await db.send(new GetItemCommand({ TableName: ACCOUNTS_TABLE, Key: { accountId: { S: accountId } } }));
  const execRoleArn = a.Item.execRoleArn.S;

  const c = await assumeInSandbox(execRoleArn, "engine-nuke");

  // Revoke the learner's live console session NOW — deny everything for sessions
  // issued before this moment. So "End" actually ends their AWS access instantly,
  // instead of the federated session outliving the (minutes-long) wipe.
  try {
    const iam = new IAMClient({
      region: REGION,
      credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
    });
    await iam.send(
      new PutRolePolicyCommand({
        RoleName: "ShieldSyncLabUser",
        PolicyName: "ShieldSyncRevokeSessions",
        PolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Sid: "Revoke", Effect: "Deny", Action: "*", Resource: "*", Condition: { DateLessThan: { "aws:TokenIssueTime": new Date().toISOString() } } },
          ],
        }),
      })
    );
    console.log(`  revoked learner console session on ${accountId}`);
  } catch (e) {
    console.log(`  (revoke note: ${e.name})`);
  }

  // In Lambda, binary is downloaded to /tmp at init; locally use the bundled exe.
  const nukeExe = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? "/tmp/aws-nuke"
    : join(__dirname, "bin", process.platform === "win32" ? "aws-nuke.exe" : "aws-nuke-linux");
  const nukeCfg = join(tmpdir(), `nuke-${accountId}-${rid(6)}.yaml`);
  writeFileSync(nukeCfg, nukeConfigFor(accountId));
  console.log(`  running aws-nuke (full wipe) on ${accountId} ...`);
  try {
    await execFileAsync(
      nukeExe,
      ["run", "--config", nukeCfg, "--no-prompt", "--no-dry-run", "--no-alias-check", "--max-wait-retries", "30"],
      {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: c.AccessKeyId,
          AWS_SECRET_ACCESS_KEY: c.SecretAccessKey,
          AWS_SESSION_TOKEN: c.SessionToken,
          AWS_DEFAULT_REGION: REGION,
        },
        maxBuffer: 20 * 1024 * 1024,
      }
    );
  } catch (e) {
    const detail = ((e.stderr || "") + (e.stdout || "")).slice(-3000) || e.message;
    throw new Error(`aws-nuke failed: ${detail}`);
  }

  await db.send(
    new UpdateItemCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { accountId: { S: accountId } },
      UpdateExpression: "SET #s = :avail REMOVE currentSessionId, warmLab, warmStackName, warmReady",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":avail": { S: "available" } },
    })
  );
  await db.send(
    new UpdateItemCommand({
      TableName: SESSIONS_TABLE,
      Key: { sessionId: { S: sessionId } },
      UpdateExpression: "SET #s = :done, endedAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":done": { S: "done" }, ":t": { S: new Date().toISOString() } },
    })
  );
  return { accountId, status: "released_to_pool" };
}

/**
 * reap(): find active/leasing sessions whose expiresAt has passed and tear each
 * down. Run on a schedule (EventBridge in prod). Returns what it reaped.
 */
export async function reap() {
  const db = await ddb();
  const nowMs = Date.now();
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "(#s = :leasing OR #s = :active) AND attribute_exists(expiresAt)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":leasing": { S: "leasing" }, ":active": { S: "active" } },
    })
  );
  const active = scan.Items ?? [];
  const expired = active.filter((it) => new Date(it.expiresAt.S).getTime() < nowMs);

  const reaped = [];
  for (const it of expired) {
    const sid = it.sessionId.S;
    console.log(`  reaping expired session ${sid} (expired ${it.expiresAt.S}) ...`);
    try {
      await teardown(sid);
      reaped.push(sid);
    } catch (e) {
      console.log(`  FAILED to reap ${sid}: ${e.message}`);
    }
  }
  return { activeChecked: active.length, expired: expired.length, reaped };
}

/**
 * upsertUser(): record a signed-in user (id = Cognito sub) in the users table —
 * the marketing list. Stamps firstSeen once, refreshes name/email/lastSeen on
 * every login. Idempotent.
 */
export async function upsertUser({ id, email, name, provider }) {
  if (!id) throw new Error("user id required");
  const db = await ddb();
  const now = new Date().toISOString();
  await db.send(
    new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: { userId: { S: String(id) } },
      UpdateExpression:
        "SET email = :e, #n = :n, #p = :p, lastSeen = :t, firstSeen = if_not_exists(firstSeen, :t), logins = if_not_exists(logins, :z) + :one",
      ExpressionAttributeNames: { "#n": "name", "#p": "provider" },
      ExpressionAttributeValues: {
        ":e": { S: String(email ?? "") },
        ":n": { S: String(name ?? "") },
        ":p": { S: String(provider ?? "") },
        ":t": { S: now },
        ":z": { N: "0" },
        ":one": { N: "1" },
      },
    })
  );
  return { userId: String(id) };
}
