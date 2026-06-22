// Load-test the free-pool wait-room / countdown path WITHOUT spinning up real AWS
// labs. It seeds the sessions table with synthetic "active free" rows to fill the
// pool, then exercises the REAL deployed engine:
//
//   1. pool full  → POST /launch (fresh user) must return 503 FREE_AT_CAPACITY
//                   with nextFreeAt == the earliest seeded expiry (drives countdown)
//   2. boundary   → with one seat free, freeCapacity must report NOT reached
//   3. countdown  → nextFreeAt advances to the next expiry as seats free
//
// Every seeded row is tagged loadtest=true and deleted in a finally block, so the
// live pool + real sessions are never touched. Run from labs-platform/engine:
//
//   node load-test-waitroom.mjs
//
// Uses the same management CLI creds as the other dev scripts (assumes into the
// platform account where the tables + Lambda live).

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const SESSIONS = "ShieldSyncLabSessions";
const ACCOUNTS = "ShieldSyncLabAccounts";
const QUEUE = "ShieldSyncLabQueue";
const FN = "ShieldSyncEngine";
const FREE_LAB = "s3-misconfiguration-audit";
const FREE_POOL_PCT = 1.0; // must match labinfra.mjs

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
};

// ── creds (assume into platform) ────────────────────────────────────────────
const sts = new STSClient({ region: REGION });
const cr = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "loadtest-waitroom",
    })
  )
).Credentials;
const credentials = {
  accessKeyId: cr.AccessKeyId,
  secretAccessKey: cr.SecretAccessKey,
  sessionToken: cr.SessionToken,
};
const db = new DynamoDBClient({ region: REGION, credentials });
const lam = new LambdaClient({ region: REGION, credentials });

// ── engine endpoint + shared secret ─────────────────────────────────────────
const cfg = await lam.send(new GetFunctionConfigurationCommand({ FunctionName: FN }));
const secret = cfg.Environment?.Variables?.ENGINE_SHARED_SECRET;
// The app reaches the engine via API Gateway (the Lambda Function URL's *.on.aws
// host isn't resolvable from some ISP DNS). This is the same base the app uses.
const base = (process.env.ENGINE_URL ?? "https://lewssnjjhi.execute-api.us-east-1.amazonaws.com").replace(/\/+$/, "");
if (!secret || !base) throw new Error("could not resolve engine URL/secret");

// ── pool size → free cap ────────────────────────────────────────────────────
const acc = await db.send(new ScanCommand({ TableName: ACCOUNTS, Select: "COUNT" }));
const total = acc.Count ?? 0;
const cap = Math.max(1, Math.floor(total * FREE_POOL_PCT));
console.log(`\nPool: ${total} account(s) → free cap ${cap}. Engine: ${base}\n`);

// Replicate labinfra.freeCapacity() against live data (read-only) so we can check
// the boundary without launching a real lab.
async function liveFreeCapacity() {
  const now = Date.now();
  const scan = await db.send(
    new ScanCommand({
      TableName: SESSIONS,
      FilterExpression: "(#s = :a OR #s = :l) AND attribute_exists(expiresAt) AND labSlug = :lab",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":a": { S: "active" }, ":l": { S: "leasing" }, ":lab": { S: FREE_LAB },
      },
    })
  );
  const expiries = (scan.Items ?? [])
    .filter((s) => new Date(s.expiresAt.S).getTime() > now)
    .map((s) => s.expiresAt.S);
  const busy = expiries.length;
  return { busy, cap, reached: busy >= cap, nextFreeAt: busy ? [...expiries].sort()[0] : null };
}

const baseline = await liveFreeCapacity();
if (baseline.busy > 0) {
  console.log(`⚠️  ${baseline.busy} real free session(s) already live — seeding on top would over-fill.`);
  console.log(`    Aborting so we don't disturb live users. Re-run when the free pool is idle.\n`);
  process.exit(1);
}

// ── seed `cap` synthetic active-free sessions, staggered expiries ───────────
const stamp = Date.now();
const seeds = [];
for (let i = 0; i < cap; i++) {
  const sid = `loadtest-seed-${i}-${stamp}`;
  const exp = new Date(stamp + (6 + i * 3) * 60000).toISOString(); // +6, +9, +12 min …
  seeds.push({ sid, exp });
}
const earliest = [...seeds.map((s) => s.exp)].sort()[0];

try {
  console.log(`Seeding ${cap} synthetic active-free session(s)…`);
  for (let i = 0; i < seeds.length; i++) {
    await db.send(new PutItemCommand({
      TableName: SESSIONS,
      Item: {
        sessionId: { S: seeds[i].sid },
        userId: { S: `loadtest-user-${i}-${stamp}` },
        labSlug: { S: FREE_LAB },
        status: { S: "active" },
        expiresAt: { S: seeds[i].exp },
        accountId: { S: "LOADTEST-FAKE" }, // not a real pool account
        startedAt: { S: new Date(stamp).toISOString() },
        loadtest: { BOOL: true },
      },
    }));
  }

  // queue helper: GET /queue as a given user
  const launcherId = `loadtest-launcher-${stamp}`;
  const qA = `loadtest-qA-${stamp}`;
  const qB = `loadtest-qB-${stamp}`;
  const qget = (uid) =>
    fetch(`${base}/queue?labSlug=${FREE_LAB}`, {
      headers: { "x-engine-token": secret, "x-user-id": uid },
    }).then((res) => res.json());

  // 1) Pool full → fresh user must get 503 FREE_AT_CAPACITY + nextFreeAt=earliest
  //    and be placed 1st in line (the only waiter so far).
  console.log(`\nTest 1 — pool full, fresh user launches:`);
  const r = await fetch(`${base}/launch`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-engine-token": secret, "x-user-id": launcherId },
    body: JSON.stringify({ labSlug: FREE_LAB }),
  });
  const body = await r.json().catch(() => ({}));
  ok(r.status === 503, `HTTP 503 (got ${r.status})`);
  ok(body.error === "FREE_AT_CAPACITY", `error=FREE_AT_CAPACITY (got ${body.error})`);
  ok(body.nextFreeAt === earliest, `nextFreeAt = earliest expiry (${body.nextFreeAt} == ${earliest})`);
  ok(typeof body.nextFreeAt === "string" && new Date(body.nextFreeAt).getTime() > Date.now(),
     `nextFreeAt is in the future → countdown is positive`);
  ok(body.freeCap === cap && body.freeBusy === cap, `freeCap/freeBusy = ${cap}/${cap} (got ${body.freeCap}/${body.freeBusy})`);
  ok(body.position === 1 && body.waiting === 1, `503 places launcher 1st in line (pos ${body.position}/${body.waiting})`);

  // 3) Place-in-line queue (pool still full): order is stable + FIFO by enqueue.
  console.log(`\nTest 3 — wait-room queue ordering (pool full):`);
  const a1 = await qget(qA); // queue: launcher, A
  ok(a1.reached === true, `/queue reports reached=true while full`);
  ok(a1.position === 2 && a1.waiting === 2, `A is 2nd of 2 (got ${a1.position}/${a1.waiting})`);
  const b1 = await qget(qB); // queue: launcher, A, B
  ok(b1.position === 3 && b1.waiting === 3, `B is 3rd of 3 (got ${b1.position}/${b1.waiting})`);
  const a2 = await qget(qA); // A re-polls — place must stay 2 (not jump behind B)
  ok(a2.position === 2 && a2.waiting === 3, `A's place is stable at 2 of 3 on re-poll (got ${a2.position}/${a2.waiting})`);

  // 2) Free one seat → boundary: NOT reached, nextFreeAt advances to next expiry
  console.log(`\nTest 2 — free the earliest seat, recheck capacity:`);
  await db.send(new DeleteItemCommand({ TableName: SESSIONS, Key: { sessionId: { S: seeds[0].sid } } }));
  const after = await liveFreeCapacity();
  ok(after.reached === false, `cap-1 busy → NOT reached (busy ${after.busy}/${cap})`);
  if (cap > 1) {
    ok(after.nextFreeAt === seeds[1].exp, `nextFreeAt advanced to the next expiry (${after.nextFreeAt})`);
  } else {
    ok(after.nextFreeAt === null, `no seats busy → nextFreeAt null`);
  }

  // 4) Seat now free → /queue reports reached=false (client should launch) and
  //    drops the poller from the line.
  console.log(`\nTest 4 — a seat is free, poll /queue:`);
  const a3 = await qget(qA);
  ok(a3.reached === false, `/queue reports reached=false when a seat is open`);
  ok(a3.position === 0, `position cleared to 0 (got ${a3.position})`);
  const qrow = await db.send(new GetItemCommand({ TableName: QUEUE, Key: { userId: { S: qA } } }));
  ok(!qrow.Item, `A was dequeued from the line after getting the all-clear`);
} finally {
  // ── cleanup: delete every seeded row + queue row no matter what ───────────
  console.log(`\nCleanup — deleting ${seeds.length} seeded session(s) + queue rows…`);
  for (const s of seeds) {
    await db.send(new DeleteItemCommand({ TableName: SESSIONS, Key: { sessionId: { S: s.sid } } })).catch(() => {});
  }
  for (const uid of [`loadtest-launcher-${stamp}`, `loadtest-qA-${stamp}`, `loadtest-qB-${stamp}`]) {
    await db.send(new DeleteItemCommand({ TableName: QUEUE, Key: { userId: { S: uid } } })).catch(() => {});
  }
  const end = await liveFreeCapacity();
  console.log(`  free pool now: ${end.busy} busy (should be 0 if it was idle at start)`);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
