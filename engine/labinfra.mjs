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
  QueryCommand,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  waitUntilStackCreateComplete,
} from "@aws-sdk/client-cloudformation";
import { IAMClient, PutRolePolicyCommand, DeleteRolePolicyCommand } from "@aws-sdk/client-iam";
import { createHash, randomBytes } from "node:crypto";
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
const ENTITLEMENTS_TABLE = "ShieldSyncLabEntitlements";
const RATINGS_TABLE = "ShieldSyncLabRatings";
const USER_LOCKS_TABLE = "ShieldSyncLabUserLocks"; // H3: one-live-session-per-user guard (TTL on `ttl`)
const QUEUE_TABLE = "ShieldSyncLabQueue"; // wait-room "place in line" (informational; TTL on `ttl`)
const ORDERS_TABLE = "ShieldSyncLabOrders"; // payment orders — webhook validates payment vs this (TTL on `ttl`)
const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

// Per-level access rules — SINGLE SOURCE for the engine (authoritative).
// The APP mirrors these in app/lib/access-rules.ts — keep the two in sync.
//   sessionMinutes: how long ONE live run lasts before the reaper tears it down.
//   maxLaunches / windowHours: how many runs a user gets in a rolling window.
const LEVEL_RULES = {
  Beginner: { sessionMinutes: 30, maxLaunches: 3, windowHours: 72 },
  // sessionMinutes MUST be >= the lab's estimatedActiveMinutes (IAM ~75 → 90). Keep
  // in sync with app/lib/access-rules.ts.
  Intermediate: { sessionMinutes: 90, maxLaunches: 2, windowHours: 48 },
  Advanced: { sessionMinutes: 120, maxLaunches: 2, windowHours: 48 },
};

// The FREE lab is a lead magnet: ONE run per user / 24h. Pre-launch we optimize
// for a great first try (a 30-min beginner lab is easy to run out of, so "come
// back tomorrow" beats "in two days"); tighten via FREE_POOL_PCT once paid is live.
const FREE_RULE = { sessionMinutes: 30, maxLaunches: 1, windowHours: 24 };

// Whitelist for lab slugs to block path traversal — labSlug is interpolated into
// fs paths (lab.json, template.yaml) and a CFN stack name, so it must be safe.
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isSafeSlug(s) {
  return typeof s === "string" && SAFE_SLUG.test(s);
}

// A lab's { level, free }, read from its bundled lab.json (safe defaults if missing).
function labMeta(labSlug) {
  if (!isSafeSlug(labSlug)) return { level: "Beginner", free: false };
  try {
    const j = JSON.parse(readFileSync(join(__dirname, "labs", labSlug, "lab.json"), "utf8"));
    return { level: j.level && LEVEL_RULES[j.level] ? j.level : "Beginner", free: j.free === true };
  } catch {
    return { level: "Beginner", free: false };
  }
}

/** rulesFor(): access rules for a lab — free labs use FREE_RULE, else the level rule.
 *  Carries a `free` flag so the caller can apply the free-pool cap. */
export function rulesFor(labSlug) {
  const { level, free } = labMeta(labSlug);
  return { ...(free ? FREE_RULE : LEVEL_RULES[level] ?? LEVEL_RULES.Beginner), free };
}

// Free labs may occupy at most this SHARE of the whole account pool at once, so a
// rush of free users can never starve paying customers. Scales as the pool grows
// (e.g. 20 accounts → 6 free slots, 14 always reserved for paid). Min 1 so the
// free lab still works on a tiny pool.
// INTERIM (2026-06-22): the paid tier isn't live yet, so reserving capacity for
// paid only throttles free users. Set to 1.0 so free can use the WHOLE pool
// (3 accounts → 3 concurrent free). Revert to ~0.3 once paid launches.
const FREE_POOL_PCT = 1.0;

async function poolSize() {
  const db = await ddb();
  const r = await db.send(new ScanCommand({ TableName: ACCOUNTS_TABLE, Select: "COUNT" }));
  return r.Count ?? 0;
}

// Pool census by status — for the PoolAvailable/PoolLeased/PoolStuck metrics.
// "stuck" = leased but with no live session pointing back (drifted/orphaned).
export async function poolCounts() {
  const db = await ddb();
  const r = await db.send(new ScanCommand({ TableName: ACCOUNTS_TABLE }));
  const items = r.Items ?? [];
  const n = (s) => items.filter((i) => i.status?.S === s).length;
  const stuck = items.filter((i) => i.status?.S === "leased" && !i.currentSessionId?.S).length;
  return { total: items.length, available: n("available"), leased: n("leased"), warming: n("warming"), cleaning: n("cleaning"), stuck };
}

// expiresAt of every LIVE free-lab session (active/leasing, non-expired). Drives
// both the free-pool count AND the "next slot frees at" wait-room countdown.
async function activeFreeExpiries() {
  const db = await ddb();
  const now = Date.now();
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "(#s = :a OR #s = :l) AND attribute_exists(expiresAt)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":a": { S: "active" }, ":l": { S: "leasing" } },
    })
  );
  return (scan.Items ?? [])
    .filter((s) => new Date(s.expiresAt.S).getTime() > now && labMeta(s.labSlug?.S ?? "").free)
    .map((s) => s.expiresAt.S);
}

/**
 * freeCapacity(): is the free-lab share of the pool already full? Free runs are
 * capped at FREE_POOL_PCT of the pool (min 1). Also returns nextFreeAt — the
 * soonest a free slot frees (earliest-expiring live free session) — so the UI
 * can show a wait countdown. (Upper bound: a slot can free sooner if a learner
 * finishes early.)
 */
export async function freeCapacity() {
  const [total, expiries] = await Promise.all([poolSize(), activeFreeExpiries()]);
  const busy = expiries.length;
  const cap = Math.max(1, Math.floor(total * FREE_POOL_PCT));
  // ISO timestamps sort lexicographically = chronologically (all UTC) → earliest first.
  const nextFreeAt = expiries.length ? [...expiries].sort()[0] : null;
  return { total, busy, cap, reached: busy >= cap, nextFreeAt };
}

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

export async function assumeInSandbox(roleArn, sessionName, durationSeconds) {
  // Lambda runs in the platform account — use execution role directly.
  // Local dev assumes into the platform account first via platformCreds().
  const stsCfg = { region: REGION, maxAttempts: 5, retryMode: "adaptive" }; // ride out AssumeRole throttling under burst
  const sts = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? new STSClient(stsCfg)
    : new STSClient({ ...stsCfg, credentials: await platformCreds() });
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
  // CSPRNG-backed (was Math.random) — used for session/order ids. Ownership is
  // enforced separately so this isn't an access control, but predictable session
  // ids are poor practice (audit L1).
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += a[bytes[i] % a.length];
  return s;
}

/**
 * lease(): atomically claim an available account; stamp an expiry window.
 * Prefers an account already PRE-WARMED with this lab -> the session is born
 * "active" (instant start, no deploy). Otherwise claims a cold account ->
 * "leasing" and the caller deploys in the background.
 */
export async function lease(userId, labSlug, windowMinutes = 30, ipHash = null) {
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
      // DynamoDB TTL: auto-delete the row 7 days after it expires. Keeps the table
      // (and every Scan over it — launchCount/findActiveSession/reap) bounded to a
      // rolling week instead of growing forever. 7d > the max launch window (72h) so
      // it never deletes a row a rolling-window count still needs.
      ttl: { N: String(Math.floor(new Date(expiresAt).getTime() / 1000) + 7 * 24 * 3600) },
      ...(ipHash ? { ipHash: { S: ipHash } } : {}),
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
export async function findActiveSession(userId, labSlug) {
  const db = await ddb();
  // When labSlug is given, only reconnect to a live session FOR THAT LAB —
  // otherwise launching lab B while lab A is live would silently hand back lab
  // A's session (wrong-lab console). Omitting labSlug keeps the old behaviour
  // (any live session) for callers that want it.
  let filter = "userId = :u AND (#s = :active OR #s = :leasing) AND attribute_exists(expiresAt)";
  const values = { ":u": { S: userId }, ":active": { S: "active" }, ":leasing": { S: "leasing" } };
  if (labSlug) {
    filter += " AND labSlug = :l";
    values[":l"] = { S: labSlug };
  }
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: filter,
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: values,
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

/**
 * launchCount(): how many times this user has launched this lab within the last
 * `windowHours`. Excludes failed (status "error") launches so a broken deploy
 * doesn't burn one of the user's allotted runs. Used to enforce per-level limits.
 */
export async function launchCount(userId, labSlug, windowHours) {
  const db = await ddb();
  const sinceMs = Date.now() - windowHours * 3600 * 1000;
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "userId = :u AND labSlug = :l AND attribute_exists(startedAt)",
      ExpressionAttributeValues: { ":u": { S: userId }, ":l": { S: labSlug } },
    })
  );
  return (scan.Items ?? []).filter(
    (s) => new Date(s.startedAt.S).getTime() >= sinceMs && s.status?.S !== "error"
  ).length;
}

/**
 * nextLaunchAt(): the ISO time the user's next run frees up for this lab — i.e.
 * when their in-window launch count drops back below maxLaunches. That's when the
 * oldest launch that needs to age out leaves the rolling window. Returns null if
 * they're not actually at the cap. Lets the UI show an exact "unlocks at HH:MM"
 * instead of a vague "about 24h after your last one".
 */
export async function nextLaunchAt(userId, labSlug, windowHours, maxLaunches) {
  const db = await ddb();
  const sinceMs = Date.now() - windowHours * 3600 * 1000;
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "userId = :u AND labSlug = :l AND attribute_exists(startedAt)",
      ExpressionAttributeValues: { ":u": { S: userId }, ":l": { S: labSlug } },
    })
  );
  const startTimes = (scan.Items ?? [])
    .filter((s) => new Date(s.startedAt.S).getTime() >= sinceMs && s.status?.S !== "error")
    .map((s) => new Date(s.startedAt.S).getTime())
    .sort((a, b) => a - b); // oldest first
  if (startTimes.length < maxLaunches) return null;
  // The launch that must age out to get back under the cap (handles maxLaunches > 1).
  const target = startTimes[startTimes.length - maxLaunches];
  return new Date(target + windowHours * 3600 * 1000).toISOString();
}

// ── Abuse guards keyed by client IP ─────────────────────────────────────────
// The app forwards Cloudflare's CF-Connecting-IP; we store/count only a salted
// HASH (never the raw IP) so this stays privacy-preserving while still catching
// sock-puppet farming from one network.

export function hashIp(ip) {
  if (!ip) return null;
  // Salt with a per-deployment SECRET (the engine shared secret, which lives only
  // in the Lambda env — not in source) so the hash isn't brute-forceable from the
  // code over the small IPv4 space (audit L2). Falls back to a constant in local
  // dev. Changing the salt just resets the rolling per-IP counters once.
  const salt = process.env.ENGINE_SHARED_SECRET || "shieldsync-dev";
  return createHash("sha256").update(salt + ":" + String(ip)).digest("hex").slice(0, 32);
}

async function sessionsForIp(ipHash) {
  const db = await ddb();
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS_TABLE,
      FilterExpression: "ipHash = :h AND attribute_exists(startedAt)",
      ExpressionAttributeValues: { ":h": { S: ipHash } },
    })
  );
  return scan.Items ?? [];
}

/** ipLaunchCount(): launches (any lab) from this IP in the last `minutes` — a
 *  per-network rate cap so one IP can't farm accounts in a burst. Excludes errors. */
export async function ipLaunchCount(ipHash, minutes) {
  if (!ipHash) return 0;
  const sinceMs = Date.now() - minutes * 60000;
  return (await sessionsForIp(ipHash)).filter(
    (s) => new Date(s.startedAt.S).getTime() >= sinceMs && s.status?.S !== "error"
  ).length;
}

/** freeIpCount(): FREE-lab launches from this IP in the window — defeats the
 *  "many Google accounts, one network" bypass of the per-user free cap. */
export async function freeIpCount(ipHash, windowHours) {
  if (!ipHash) return 0;
  const sinceMs = Date.now() - windowHours * 3600000;
  return (await sessionsForIp(ipHash)).filter(
    (s) => new Date(s.startedAt.S).getTime() >= sinceMs && s.status?.S !== "error" && labMeta(s.labSlug?.S ?? "").free
  ).length;
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
    // Owner of this session — used by the engine's HTTP layer for ownership
    // checks on /teardown, /console, /grade, GET /session/<id>.
    userId: it.userId?.S,
  };
}

/**
 * releaseAccount(): return an account to the available pool without running
 * aws-nuke. Use after a FAILED deploy (nothing was provisioned, so there is
 * nothing to destroy) so the account isn't stranded in "leased" forever.
 */
export async function releaseAccount(accountId) {
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { accountId: { S: accountId } },
      UpdateExpression: "SET #s = :avail REMOVE currentSessionId, warmLab, warmStackName, warmReady",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":avail": { S: "available" } },
    })
  );
}

// ── H3: per-user launch lock ────────────────────────────────────────────────
// Enforces ONE live session per user, atomically. The conditional PutItem closes
// the TOCTOU window where two concurrent /launch calls could each lease an
// account. Released on teardown / deploy-failure / launch-reject; DynamoDB TTL on
// `ttl` is the backstop so a missed release self-clears.

/**
 * acquireUserLock(): atomically claim the per-user launch lock. Succeeds if the
 * user has no lock or their lock's ttl has already passed. Returns
 * {acquired:true} or {acquired:false, labSlug} (the lab they already hold).
 */
export async function acquireUserLock(userId, labSlug, ttlSeconds) {
  const db = await ddb();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await db.send(
      new PutItemCommand({
        TableName: USER_LOCKS_TABLE,
        Item: {
          userId: { S: userId },
          labSlug: { S: labSlug },
          ttl: { N: String(nowSec + ttlSeconds) },
          acquiredAt: { S: new Date().toISOString() },
        },
        ConditionExpression: "attribute_not_exists(userId) OR #ttl < :now",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":now": { N: String(nowSec) } },
      })
    );
    return { acquired: true };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const cur = await db.send(new GetItemCommand({ TableName: USER_LOCKS_TABLE, Key: { userId: { S: userId } } }));
      return { acquired: false, labSlug: cur.Item?.labSlug?.S };
    }
    throw e;
  }
}

/** bindLockSession(): record the sessionId on the user's lock (traceability). */
export async function bindLockSession(userId, sessionId) {
  const db = await ddb();
  await db
    .send(
      new UpdateItemCommand({
        TableName: USER_LOCKS_TABLE,
        Key: { userId: { S: userId } },
        UpdateExpression: "SET sessionId = :sid",
        ExpressionAttributeValues: { ":sid": { S: sessionId } },
      })
    )
    .catch(() => {});
}

/** releaseUserLock(): drop the per-user lock (idempotent). */
export async function releaseUserLock(userId) {
  if (!userId) return;
  const db = await ddb();
  await db
    .send(new DeleteItemCommand({ TableName: USER_LOCKS_TABLE, Key: { userId: { S: userId } } }))
    .catch(() => {});
}

// ── Wait-room queue: informational "place in line" ─────────────────────────
// Tracks who is WAITING for a free seat so the UI can show "~Nth in line".
// PURELY INDICATIVE — allocation stays first-to-retry. There is NO head-of-line
// handoff, so an abandoned waiter can never deadlock the pool. Entries carry a
// short TTL refreshed on every poll; a waiter who leaves ages out within ~ttl.
// (DynamoDB TTL deletion is eventual, so reads also filter expired rows.)

/** enqueueWaiter(): record/refresh this user as waiting for `labSlug`. The first
 *  wait timestamp sticks (so position is stable across polls); switching labs
 *  resets the place; ttl is always bumped so live waiters stay counted. */
export async function enqueueWaiter(userId, labSlug, ttlSeconds = 90) {
  if (!userId) return;
  const db = await ddb();
  const nowMs = Date.now();
  const ttl = Math.floor(nowMs / 1000) + ttlSeconds;
  const cur = await db
    .send(new GetItemCommand({ TableName: QUEUE_TABLE, Key: { userId: { S: userId } } }))
    .catch(() => ({}));
  const sameLab = cur.Item?.labSlug?.S === labSlug && cur.Item?.enqueuedAt?.N;
  const enqueuedAt = sameLab ? cur.Item.enqueuedAt.N : String(nowMs);
  await db.send(
    new PutItemCommand({
      TableName: QUEUE_TABLE,
      Item: {
        userId: { S: userId },
        labSlug: { S: labSlug },
        enqueuedAt: { N: enqueuedAt },
        ttl: { N: String(ttl) },
      },
    })
  );
}

/** queuePosition(): {position (1-based), waiting (total live waiters)} for this
 *  user/lab. Excludes TTL-expired rows. A caller not yet enqueued is treated as
 *  last in line. */
export async function queuePosition(userId, labSlug) {
  const db = await ddb();
  const nowSec = Math.floor(Date.now() / 1000);
  const scan = await db.send(
    new ScanCommand({
      TableName: QUEUE_TABLE,
      FilterExpression: "labSlug = :l AND #ttl > :now AND attribute_exists(enqueuedAt)",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      ExpressionAttributeValues: { ":l": { S: labSlug }, ":now": { N: String(nowSec) } },
    })
  );
  const items = scan.Items ?? [];
  const waiting = items.length;
  const mine = items.find((i) => i.userId?.S === userId);
  if (!mine) return { position: waiting + 1, waiting: waiting + 1 };
  const myAt = Number(mine.enqueuedAt.N);
  const ahead = items.filter((i) => Number(i.enqueuedAt.N) < myAt).length;
  return { position: ahead + 1, waiting };
}

/** dequeueWaiter(): drop this user from the line (idempotent) — call when they
 *  get a seat so they stop counting against everyone behind them. */
export async function dequeueWaiter(userId) {
  if (!userId) return;
  const db = await ddb();
  await db
    .send(new DeleteItemCommand({ TableName: QUEUE_TABLE, Key: { userId: { S: userId } } }))
    .catch(() => {});
}

// ── Payment orders (runbook §6d) ────────────────────────────────────────────
// The server-side record the real-provider webhook validates a payment against
// (amount/currency) instead of a client-replayable payload, then grants ONLY on
// an idempotent created->paid transition. status is forced server-side.

/** createOrder(): persist a checkout order as "created". Won't overwrite a PAID
 *  order (so a paid order can never be reset to re-grant). 90-day TTL. */
export async function createOrder(order) {
  if (!order?.id || !order?.userId) throw new Error("order id + userId required");
  const db = await ddb();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  try {
    await db.send(
      new PutItemCommand({
        TableName: ORDERS_TABLE,
        Item: {
          orderId: { S: String(order.id) },
          userId: { S: String(order.userId) },
          labSlug: { S: String(order.labSlug ?? "") },
          plan: { S: String(order.plan) },
          amountMinor: { N: String(order.amountMinor ?? 0) },
          currency: { S: String(order.currency ?? "INR") },
          status: { S: "created" }, // forced — never trust a client-supplied status
          createdAt: { S: String(order.createdAt ?? new Date().toISOString()) },
          ttl: { N: String(ttl) },
        },
        ConditionExpression: "attribute_not_exists(orderId) OR #s <> :paid",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":paid": { S: "paid" } },
      })
    );
  } catch (e) {
    if (e.name !== "ConditionalCheckFailedException") throw e;
    // an already-PAID order with this id exists — leave it untouched.
  }
}

/** getOrder(): fetch one order (or null). labSlug "" maps back to null. */
export async function getOrder(orderId) {
  if (!orderId) return null;
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: ORDERS_TABLE, Key: { orderId: { S: String(orderId) } } }));
  const it = r.Item;
  if (!it) return null;
  return {
    id: it.orderId.S,
    userId: it.userId?.S,
    labSlug: it.labSlug?.S ? it.labSlug.S : null,
    plan: it.plan?.S,
    amountMinor: Number(it.amountMinor?.N ?? 0),
    currency: it.currency?.S,
    status: it.status?.S,
    createdAt: it.createdAt?.S,
    paymentId: it.paymentId?.S ?? null,
    paidAt: it.paidAt?.S ?? null,
  };
}

/** markOrderPaid(): atomic, idempotent created->paid. Returns true ONLY for the
 *  call that actually flipped it — so out of N webhook retries exactly one grants. */
export async function markOrderPaid(orderId, paymentId) {
  if (!orderId) return false;
  const db = await ddb();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: ORDERS_TABLE,
        Key: { orderId: { S: String(orderId) } },
        UpdateExpression: "SET #s = :paid, paymentId = :pid, paidAt = :now",
        ConditionExpression: "#s = :created", // only the created->paid transition wins
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":paid": { S: "paid" },
          ":created": { S: "created" },
          ":pid": { S: String(paymentId ?? "") },
          ":now": { S: new Date().toISOString() },
        },
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return false; // already paid / missing
    throw e;
  }
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
  // Hard sanity check: labSlug controls a filesystem path, so it must match the
  // whitelist. Any caller that already validated (labMeta/rulesFor) is fine; this
  // is the last-line defence against path traversal making it into a deploy.
  if (!isSafeSlug(labSlug)) throw new Error("invalid labSlug");
  const templatePath = join(__dirname, "labs", labSlug, "template.yaml");
  const templateBody = readFileSync(templatePath, "utf8");
  const c = await assumeInSandbox(execRoleArn, "engine-deploy");
  const cfn = new CloudFormationClient({
    region: REGION,
    credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
    // Ride out transient AWS errors (throttling under a launch burst, eventual
    // consistency) without failing the user's launch — adaptive mode adds client
    // -side rate limiting on top of retries.
    maxAttempts: 5,
    retryMode: "adaptive",
  });
  await cfn.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: ["CAPABILITY_NAMED_IAM"],
      // DELETE (not DO_NOTHING): a CREATE_FAILED stack auto-rolls-back + deletes, so
      // it leaves no debris, the account recycles cleanly, and the stack name is
      // free if the learner retries. (Was DO_NOTHING — a dev-only setting.)
      OnFailure: "DELETE",
      Tags: tags,
    })
  );
  // 540s (cold deploys finish in ~80–110s; OnFailure=DELETE auto-cleans real
  // failures). The old 280s could time out while the stack was STILL creating →
  // it would later reach CREATE_COMPLETE on an account already re-pooled →
  // account-named-bucket collision → CREATE_FAILED for the next customer. The
  // wide margin (well under the 900s Lambda budget) makes that race vanishingly rare.
  await waitUntilStackCreateComplete({ client: cfn, maxWaitTime: 540 }, { StackName: stackName });
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
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: { S: sessionId } },
        // Only flip to "active" if the session is STILL leasing. If it was torn
        // down (ending/done/error) while this cold deploy was in flight, do NOT
        // resurrect it — otherwise a teardown-during-deploy race leaves a zombie
        // "active" session on an account teardown is already wiping. teardown +
        // the reaper reclaim the account; the lock TTL clears the user lock.
        UpdateExpression: "SET #s = :active, stackName = :sn",
        ConditionExpression: "#s = :leasing",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":active": { S: "active" }, ":sn": { S: stackName }, ":leasing": { S: "leasing" } },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      console.warn(`[deployLab] ${sessionId} no longer leasing — skipping activate (torn down mid-deploy); teardown/reaper will reclaim ${accountId}`);
      return { stackName, outputs, skipped: true };
    }
    throw e;
  }
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
  // Hard timeout so a stuck AWS federation endpoint can't hang the Lambda.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let SigninToken;
  try {
    const tokenResp = await fetch(
      `https://signin.aws.amazon.com/federation?Action=getSigninToken&Session=${encodeURIComponent(session)}`,
      { signal: ctrl.signal }
    );
    if (!tokenResp.ok) throw new Error(`federation HTTP ${tokenResp.status}`);
    ({ SigninToken } = await tokenResp.json());
  } finally {
    clearTimeout(timer);
  }
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
const STALE_TEARDOWN_MS = 12 * 60 * 1000; // a teardown older than this is presumed hung → reclaimable

export async function teardown(sessionId) {
  const db = await ddb();
  const s = await db.send(new GetItemCommand({ TableName: SESSIONS_TABLE, Key: { sessionId: { S: sessionId } } }));
  if (!s.Item) throw new Error("session not found");
  const accountId = s.Item.accountId.S;
  const lockUserId = s.Item.userId?.S; // release the per-user launch lock at the end
  // ATOMIC CLAIM: only ONE teardown may nuke a given account at a time. Flip to
  // "ending" + stamp teardownAt, conditional on the session being live (active/
  // leasing/ending) AND not already claimed within the staleness window. A second
  // concurrent reaper/heal bails (no double aws-nuke); a genuinely hung teardown
  // (>12min) becomes re-claimable so healPool can recover it. A settled
  // (done/error) session is NOT re-nuked.
  const claimAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_TEARDOWN_MS).toISOString();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: SESSIONS_TABLE,
        Key: { sessionId: { S: sessionId } },
        UpdateExpression: "SET #s = :ending, teardownAt = :now",
        ConditionExpression:
          "(#s = :active OR #s = :leasing OR #s = :ending) AND (attribute_not_exists(teardownAt) OR teardownAt < :stale)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":ending": { S: "ending" },
          ":now": { S: claimAt },
          ":active": { S: "active" },
          ":leasing": { S: "leasing" },
          ":stale": { S: staleBefore },
        },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      console.log(`[teardown] ${sessionId} already claimed/settled — skipping duplicate nuke`);
      return { accountId, status: "already_in_progress" };
    }
    throw e;
  }

  const a = await db.send(new GetItemCommand({ TableName: ACCOUNTS_TABLE, Key: { accountId: { S: accountId } } }));
  const execRoleArn = a.Item.execRoleArn.S;

  const c = await assumeInSandbox(execRoleArn, "engine-nuke");

  // Revoke the learner's live console session NOW — deny everything for sessions
  // issued before this moment. So "End" actually ends their AWS access instantly,
  // instead of the federated session outliving the (minutes-long) wipe.
  //
  // CRITICAL: a failed revoke means the federated session may outlive the nuke
  // — a real cross-tenant risk if the next learner gets the same account. We do
  // NOT swallow errors silently; we log the full reason and surface it to the
  // session record so the UI + ops can see something went wrong.
  let revokeOk = false;
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
    revokeOk = true;
    console.log(`  revoked learner console session on ${accountId}`);
  } catch (e) {
    const reason = `${e.name}: ${e.message}`;
    console.error(`  ❌ REVOKE FAILED on ${accountId}: ${reason}`);
    // Persist the failure into the session record so the UI / status endpoint
    // surface it; still proceed to nuke (wiping the account is the bigger win),
    // but the caller can see that the session-revoke step was incomplete.
    await markSession(sessionId, "ending", `revoke failed: ${reason}`).catch(() => {});
  }
  if (!revokeOk) {
    // Final breadcrumb in the logs — easy to grep.
    console.error(`  [security] account ${accountId} torn down WITHOUT a revoke — verify console URL no longer works`);
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
    // aws-nuke can echo its env (or stack traces that include it). Scrub anything
    // resembling an AWS credential before we put it in an Error message that will
    // be logged. Token leak via logs would be a real cross-tenant risk.
    const rawDetail = ((e.stderr || "") + (e.stdout || "")).slice(-3000) || e.message || "";
    const detail = String(rawDetail)
      .replace(/AKIA[0-9A-Z]{16}/g, "AKIA<redacted>")
      .replace(/ASIA[0-9A-Z]{16}/g, "ASIA<redacted>")
      .replace(/(AWS_SESSION_TOKEN|AWS_SECRET_ACCESS_KEY|aws_session_token|aws_secret_access_key)\s*[:=]\s*\S+/g, "$1=<redacted>")
      // generic long base64-ish blob (session tokens are usually >100 chars)
      .replace(/[A-Za-z0-9+/=_-]{60,}/g, "<redacted-token>");
    throw new Error(`aws-nuke failed: ${detail}`);
  }

  // #22: remove the one-shot revoke Deny we wrote at the START of this teardown so the
  // NEXT tenant inherits a clean ShieldSyncLabUser role. aws-nuke deliberately preserves
  // the control roles' inline policies, so without this the Deny would persist forever
  // (inert, but dead state that contradicts the "fully wiped" contract). Best-effort —
  // never block the account from returning to the pool.
  try {
    const iamCleanup = new IAMClient({
      region: REGION,
      credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
    });
    await iamCleanup.send(
      new DeleteRolePolicyCommand({ RoleName: "ShieldSyncLabUser", PolicyName: "ShieldSyncRevokeSessions" })
    );
  } catch (e) {
    if (e.name !== "NoSuchEntity") console.log(`  [teardown] revoke-policy cleanup skipped on ${accountId}: ${e.name}`);
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
  await releaseUserLock(lockUserId);
  return { accountId, status: "released_to_pool" };
}

/**
 * findExpiredSessions(): the identify-half of reap — active/leasing sessions whose
 * expiresAt has passed. Split out so the prod handler can DISPATCH each teardown as
 * its own async worker (parallel pool recovery) instead of nuking them serially.
 */
export async function findExpiredSessions() {
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
  return { activeChecked: active.length, expired: expired.map((it) => it.sessionId.S) };
}

/**
 * reap(): find expired sessions and tear each down SERIALLY in this invocation.
 * Used by local dev (server.mjs) and as a fallback. In prod the handler instead
 * dispatches one async teardown worker per expired session (see handler reap action)
 * so N accounts recycle concurrently — a serial reap of 3 multi-minute nukes could
 * also approach the Lambda timeout.
 */
export async function reap() {
  const { activeChecked, expired } = await findExpiredSessions();
  const reaped = [];
  for (const sid of expired) {
    console.log(`  reaping expired session ${sid} ...`);
    try {
      await teardown(sid);
      reaped.push(sid);
    } catch (e) {
      console.log(`  FAILED to reap ${sid}: ${e.message}`);
    }
  }
  return { activeChecked, expired: expired.length, reaped };
}

/**
 * healPool(): reclaim accounts whose DB state has DRIFTED (the session-based reaper
 * only catches expired sessions). Conservative on purpose — only auto-acts on cases
 * that are unambiguously safe; anything else is left for the PoolStuck alarm so a
 * human looks before we touch it. Two cases handled:
 *   1. leased account whose session already SETTLED (done/error) → the lab is already
 *      cleaned, the account just never got flipped back → releaseAccount (no nuke).
 *   2. leased account whose session is still "leasing" but is OLD (cold deploy hung /
 *      worker died, well past the ~5-min deploy max-wait) → teardown (full aws-nuke +
 *      release) in case a partial stack exists.
 * NEVER touches active+non-expired (in use), recent leasing (deploy in progress),
 * warming, or leased-with-missing-session (ambiguous → alarm).
 */
export async function healPool() {
  const db = await ddb();
  const now = Date.now();
  const HUNG_LEASING_MS = 12 * 60 * 1000;
  const scan = await db.send(
    new ScanCommand({
      TableName: ACCOUNTS_TABLE,
      FilterExpression: "#s = :leased",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":leased": { S: "leased" } },
    })
  );
  const healed = [];
  for (const a of scan.Items ?? []) {
    const accountId = a.accountId.S;
    const sid = a.currentSessionId?.S;
    if (!sid) continue; // leased w/ no session = ambiguous → leave to PoolStuck alarm
    try {
      const sres = await db.send(new GetItemCommand({ TableName: SESSIONS_TABLE, Key: { sessionId: { S: sid } } }));
      const st = sres.Item?.status?.S;
      const startedMs = sres.Item?.startedAt?.S ? new Date(sres.Item.startedAt.S).getTime() : 0;
      const teardownMs = sres.Item?.teardownAt?.S ? new Date(sres.Item.teardownAt.S).getTime() : 0;
      if (st === "done" || st === "error") {
        await releaseAccount(accountId);
        healed.push(`${accountId}(settled:${st})`);
        console.log(`  [heal] released ${accountId} — session ${sid} was ${st} but account still leased`);
      } else if (st === "leasing" && startedMs && now - startedMs > HUNG_LEASING_MS) {
        console.log(`  [heal] hung deploy — tearing down ${accountId} (session ${sid} leasing ${Math.round((now - startedMs) / 60000)}min)`);
        await teardown(sid);
        healed.push(`${accountId}(hung-deploy)`);
      } else if (st === "ending" && teardownMs && now - teardownMs > HUNG_LEASING_MS) {
        // STUCK TEARDOWN: a prior aws-nuke threw (or its worker died) before flipping
        // the account back to "available", leaving the account leased forever — a
        // permanent capacity loss on a 3-account pool. The stale teardownAt makes the
        // claim re-acquirable, so retry the wipe.
        console.log(`  [heal] stuck teardown — retrying nuke on ${accountId} (session ${sid} ending ${Math.round((now - teardownMs) / 60000)}min)`);
        await teardown(sid);
        healed.push(`${accountId}(stuck-ending)`);
      }
      // active+non-expired (in use) and recent-leasing/ending (in flight) → skip
    } catch (e) {
      console.log(`  [heal] ${accountId} failed: ${e.message}`);
    }
  }
  return { healed };
}

/**
 * grantEntitlement(): idempotently write an entitlement row.
 * labSlug "*" means all-access (monthly plan).
 */
export async function grantEntitlement(userId, { labSlug, kind, accessUntil }) {
  const db = await ddb();
  const now = new Date().toISOString();
  const expr = ["SET grantedAt = if_not_exists(grantedAt, :t)", "kind = :k"];
  const vals = { ":t": { S: now }, ":k": { S: String(kind ?? "per-lab") } };
  const names = {};
  if (accessUntil) {
    expr.push("accessUntil = :au");
    vals[":au"] = { S: String(accessUntil) };
  }
  await db.send(
    new UpdateItemCommand({
      TableName: ENTITLEMENTS_TABLE,
      Key: { userId: { S: String(userId) }, labSlug: { S: String(labSlug) } },
      UpdateExpression: expr.join(", "),
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: vals,
    })
  );
}

/**
 * listEntitlements(): return all entitlement rows for a user.
 */
export async function listEntitlements(userId) {
  if (!userId) return [];
  const db = await ddb();
  const { Items } = await db.send(
    new QueryCommand({
      TableName: ENTITLEMENTS_TABLE,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": { S: String(userId) } },
    })
  );
  return (Items ?? []).map((it) => ({
    labSlug: it.labSlug?.S,
    kind: it.kind?.S,
    accessUntil: it.accessUntil?.S ?? null,
    grantedAt: it.grantedAt?.S,
  }));
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

/**
 * recordRating(): upsert a user's 👍/👎 for a lab (product signal). One row per
 * (labSlug, userId) — latest rating wins. Query by labSlug to aggregate.
 */
export async function recordRating(userId, labSlug, rating) {
  if (!userId || !labSlug) return;
  const db = await ddb();
  await db.send(
    new PutItemCommand({
      TableName: RATINGS_TABLE,
      Item: {
        labSlug: { S: String(labSlug) },
        userId: { S: String(userId) },
        rating: { S: String(rating) },
        ratedAt: { S: new Date().toISOString() },
      },
    })
  );
}

/**
 * ratingsSummary(): aggregate 👍/👎 per lab for the admin readout. One Scan over
 * the (small) ratings table → [{labSlug, up, down, total, pct}] sorted by volume.
 * pct = % thumbs-up (null when a lab has no ratings yet).
 */
export async function ratingsSummary() {
  const db = await ddb();
  const { Items } = await db.send(new ScanCommand({ TableName: RATINGS_TABLE }));
  const by = {};
  for (const it of Items ?? []) {
    const slug = it.labSlug?.S;
    if (!slug) continue;
    by[slug] ??= { labSlug: slug, up: 0, down: 0 };
    if (it.rating?.S === "up") by[slug].up++;
    else if (it.rating?.S === "down") by[slug].down++;
  }
  return Object.values(by)
    .map((s) => ({ ...s, total: s.up + s.down, pct: s.up + s.down ? Math.round((100 * s.up) / (s.up + s.down)) : null }))
    .sort((a, b) => b.total - a.total);
}
