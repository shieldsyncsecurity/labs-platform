// Live demo helper for the wait-room queue (#3). Lets us SHOW the busy-state card
// + place-in-line + auto-grab against the real engine, then clean up. All rows are
// fixed-id and tagged demo=true so nothing real is touched.
//
//   node demo-waitroom.mjs fill    # fill the free pool + seed 2 waiters AHEAD of you
//                                  #   → your launch shows "Free labs are busy · #3 of 3"
//   node demo-waitroom.mjs free    # open one seat → your /queue poll auto-grabs it (~12s)
//   node demo-waitroom.mjs clean   # remove every demo row, restore the pool
//   node demo-waitroom.mjs status  # show current free-capacity + demo rows
//
// Uses the same mgmt CLI creds as the other dev scripts (assumes into platform).

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const SESSIONS = "ShieldSyncLabSessions";
const ACCOUNTS = "ShieldSyncLabAccounts";
const QUEUE = "ShieldSyncLabQueue";
const FREE_LAB = "s3-misconfiguration-audit";
const FREE_POOL_PCT = 1.0;

const SESS_IDS = ["demo-waitroom-sess-0", "demo-waitroom-sess-1", "demo-waitroom-sess-2"];
const Q_IDS = ["demo-waitroom-q1", "demo-waitroom-q2"];

const cmd = process.argv[2] ?? "status";

const sts = new STSClient({ region: REGION });
const cr = (
  await sts.send(new AssumeRoleCommand({
    RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
    RoleSessionName: "demo-waitroom",
  }))
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: { accessKeyId: cr.AccessKeyId, secretAccessKey: cr.SecretAccessKey, sessionToken: cr.SessionToken },
});

async function freeState() {
  const now = Date.now();
  const [acc, sess] = await Promise.all([
    db.send(new ScanCommand({ TableName: ACCOUNTS, Select: "COUNT" })),
    db.send(new ScanCommand({
      TableName: SESSIONS,
      FilterExpression: "(#s = :a OR #s = :l) AND attribute_exists(expiresAt) AND labSlug = :lab",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":a": { S: "active" }, ":l": { S: "leasing" }, ":lab": { S: FREE_LAB } },
    })),
  ]);
  const total = acc.Count ?? 0;
  const expiries = (sess.Items ?? []).filter((s) => new Date(s.expiresAt.S).getTime() > now).map((s) => s.expiresAt.S);
  const cap = Math.max(1, Math.floor(total * FREE_POOL_PCT));
  return { total, cap, busy: expiries.length, reached: expiries.length >= cap, nextFreeAt: expiries.length ? [...expiries].sort()[0] : null };
}

async function queueRows() {
  const now = Math.floor(Date.now() / 1000);
  const scan = await db.send(new ScanCommand({
    TableName: QUEUE,
    FilterExpression: "labSlug = :l AND #ttl > :now",
    ExpressionAttributeNames: { "#ttl": "ttl" },
    ExpressionAttributeValues: { ":l": { S: FREE_LAB }, ":now": { N: String(now) } },
  }));
  return (scan.Items ?? []).map((i) => ({ userId: i.userId.S, enqueuedAt: Number(i.enqueuedAt.N) })).sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

async function status() {
  const fs = await freeState();
  const q = await queueRows();
  console.log(`\nFree pool: ${fs.busy}/${fs.cap} busy (pool ${fs.total}) · reached=${fs.reached} · nextFreeAt=${fs.nextFreeAt}`);
  console.log(`Live waiters in line (${q.length}):`);
  q.forEach((w, i) => console.log(`  #${i + 1}  ${w.userId}${w.userId.startsWith("demo-waitroom") ? "" : "  ← (real user)"}`));
  console.log();
}

if (cmd === "fill") {
  const now = Date.now();
  console.log("Filling the free pool with 3 synthetic active sessions…");
  for (let i = 0; i < SESS_IDS.length; i++) {
    await db.send(new PutItemCommand({
      TableName: SESSIONS,
      Item: {
        sessionId: { S: SESS_IDS[i] },
        userId: { S: `demo-waitroom-holder-${i}` },
        labSlug: { S: FREE_LAB },
        status: { S: "active" },
        expiresAt: { S: new Date(now + (6 + i * 4) * 60000).toISOString() }, // +6/+10/+14 min
        accountId: { S: "DEMO-FAKE" }, // not a real pool account
        startedAt: { S: new Date(now).toISOString() },
        demo: { BOOL: true },
      },
    }));
  }
  console.log("Seeding 2 waiters AHEAD of you (so you land at #3 of 3)…");
  for (let i = 0; i < Q_IDS.length; i++) {
    await db.send(new PutItemCommand({
      TableName: QUEUE,
      Item: {
        userId: { S: Q_IDS[i] },
        labSlug: { S: FREE_LAB },
        enqueuedAt: { N: String(now - (10000 - i * 1000)) }, // ~10s & ~9s ago → ahead of you
        ttl: { N: String(Math.floor(now / 1000) + 1800) }, // 30 min, survives the demo
        demo: { BOOL: true },
      },
    }));
  }
  await status();
  console.log("→ Now click Launch in your browser. You should see “Free labs are busy · #3 of 3”.\n");
} else if (cmd === "free") {
  console.log("Opening one seat (deleting the soonest-expiring demo session)…");
  await db.send(new DeleteItemCommand({ TableName: SESSIONS, Key: { sessionId: { S: SESS_IDS[0] } } }));
  await status();
  console.log("→ Within ~12s your wait-room poll should auto-grab the seat and start provisioning.\n");
} else if (cmd === "clean") {
  console.log("Removing all demo rows…");
  for (const id of SESS_IDS) await db.send(new DeleteItemCommand({ TableName: SESSIONS, Key: { sessionId: { S: id } } })).catch(() => {});
  for (const id of Q_IDS) await db.send(new DeleteItemCommand({ TableName: QUEUE, Key: { userId: { S: id } } })).catch(() => {});
  await status();
  console.log("→ Demo rows cleared. (Your own queue row, if any, TTLs out on its own.)\n");
} else {
  await status();
}
