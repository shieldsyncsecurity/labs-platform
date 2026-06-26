// Reset the per-user LAUNCH COUNTER for a lab. Marks already-finished sessions
// (status="done") as "error" — `launchCount()` excludes errors so they stop
// counting toward each user's rolling-window cap. Use only for dev/smoke tests.
//
// Safe by design: only touches sessions that already ENDED (status=done), so
// the live pool + active sessions are untouched. Run from labs-platform/engine:
//
//   node try-reset-rate.mjs                                      # default: free s3 lab, last 48h
//   node try-reset-rate.mjs s3-misconfiguration-audit 72         # custom window
//   node try-reset-rate.mjs iam-privilege-escalation 48          # other lab
//
// Requires the same management CLI creds you use everywhere else (it assumes
// into the platform account itself — no need to pre-assume in your shell).

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncLabSessions";

const labSlug = process.argv[2] ?? "s3-misconfiguration-audit";
const hours = Number(process.argv[3] ?? "48");

// Assume into platform (where the DDB table lives)
const sts = new STSClient({ region: REGION });
const cr = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "reset-rate",
    })
  )
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: {
    accessKeyId: cr.AccessKeyId,
    secretAccessKey: cr.SecretAccessKey,
    sessionToken: cr.SessionToken,
  },
});

const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
const now = Date.now();
console.log(
  `Scanning ${TABLE} for labSlug=${labSlug} startedAt>=${cutoff} ...`
);

const scan = await db.send(
  new ScanCommand({
    TableName: TABLE,
    FilterExpression:
      "labSlug = :l AND startedAt >= :c AND #s <> :err",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":l": { S: labSlug },
      ":c": { S: cutoff },
      ":err": { S: "error" },
    },
  })
);

const all = scan.Items ?? [];
console.log(`\nAll non-error sessions in window: ${all.length}`);
for (const it of all) {
  const sid = it.sessionId?.S;
  const uid = it.userId?.S ?? "?";
  const st = it.status?.S;
  const exp = it.expiresAt?.S;
  const isLive = st === "active" && exp && new Date(exp).getTime() > now;
  console.log(`  ${sid}  userId=${uid}  status=${st}  expiresAt=${exp ?? "—"}  ${isLive ? "[LIVE — SKIP]" : "[settled]"}`);
}

// Anything that isn't a LIVE active session is fair game.
const settled = all.filter((it) => {
  const st = it.status?.S;
  const exp = it.expiresAt?.S;
  const isLive = st === "active" && exp && new Date(exp).getTime() > now;
  return !isLive;
});

console.log(`\nFlipping ${settled.length} settled session(s) to status=error ...`);

for (const it of settled) {
  const sid = it.sessionId.S;
  await db.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { sessionId: { S: sid } },
      UpdateExpression: "SET #s = :e, #err = :why",
      ExpressionAttributeNames: { "#s": "status", "#err": "error" },
      ExpressionAttributeValues: {
        ":e": { S: "error" },
        ":why": { S: "rate-reset (admin)" },
      },
    })
  );
}

console.log(
  `\n✅ Done. ${settled.length} session(s) excluded from the rate counter.${all.length - settled.length > 0 ? ` (${all.length - settled.length} live session(s) left alone.)` : ""}\n   You can launch again.`
);
