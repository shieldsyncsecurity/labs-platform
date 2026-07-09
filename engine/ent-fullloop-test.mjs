// Full candidate loop through a REAL lease — proves bugs 1/2/3 fixed:
//   book (bug1: ttl alias) -> start (bug2: LabUser trust -> console mint) ->
//   submit -> teardown (bug3: nuke bootstrap). OTP is bypassed by a direct DDB
//   status write (the Lambda never returns the code), the same sanctioned
//   mechanism the audit agent used. Creds assumed into 750 already in env.
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
const BASE = "https://bdkdcbhzme.execute-api.us-east-1.amazonaws.com";
const SECRET = process.env.ENT_SECRET;
const db = new DynamoDBClient({ region: "us-east-1" });
let pass = 0, fail = 0; const fails = [];
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS", n); } else { fail++; fails.push(n + (d ? " :: " + d : "")); console.log("  FAIL", n, d || ""); } };
async function call(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { "content-type": "application/json", "x-engine-token": SECRET }, body: b ? JSON.stringify(b) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let r;
console.log("=== FULL LOOP (real lease) ===");
r = await call("POST", "/ent/orgs", { name: "E2E FullLoop", creditsTotal: 3, actor: "fullloop" });
const orgId = r.j.orgId; ok("org create", r.status === 200);
r = await call("POST", "/ent/assessments", { orgId, name: "FullLoop", labSlug: "s3-misconfiguration-audit", actor: "fullloop" });
const assessmentId = r.j.assessmentId; ok("assessment create", r.status === 200);
const inviteToken = "fl" + Date.now().toString(36) + Math.floor(Math.random()*1e9).toString(36);
r = await call("POST", "/ent/invites", { assessmentId, orgId, candidateName: "Loop Cand", candidateEmail: "loop@example.com", inviteToken, actor: "fullloop" });
ok("invite create + credit", r.status === 200 && r.j.creditConsumed === true, `status ${r.status}`);
r = await call("POST", "/ent/consent", { inviteToken, consentVersion: "v1" });
ok("consent", r.status === 200, `status ${r.status}`);

// OTP bypass: set invite status -> verified directly (Lambda never returns the code)
await db.send(new UpdateItemCommand({
  TableName: "ShieldSyncEntInvites", Key: { inviteToken: { S: inviteToken } },
  UpdateExpression: "SET #s = :v", ConditionExpression: "#s = :c",
  ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":v": { S: "verified" }, ":c": { S: "consented" } },
}));
console.log("  (OTP bypassed: invite -> verified via DDB)");

// BUG 1 proof: book must now succeed (was 500 on the ttl reserved keyword)
r = await call("POST", "/ent/slots", { inviteToken });
ok("slots 200", r.status === 200);
// Unique future slot per run (each slotKey holds caps.total seats; reusing a
// past run's slot on a 1-account pool returns SLOT_FULL).
const slotKey = new Date(Date.now() + (3 + Math.floor(Math.random() * 500)) * 36e5).toISOString().slice(0, 13) + ":00:00.000Z";
r = await call("POST", "/ent/book", { inviteToken, slotKey });
ok("BUG1 book 200 (ttl alias)", r.status === 200, `status ${r.status} ${JSON.stringify(r.j).slice(0,80)}`);

// BUG 2 + 4 proof: start leases + mints console via ShieldSyncLabUser (was
// AccessDenied). The candidate flow tolerates NO_CAPACITY during the async
// pre-warm window and keeps polling — mirror that here (up to ~5 min).
let active = false, consoleUrl = null, everLeased = false;
for (let i = 0; i < 50; i++) {
  r = await call("POST", "/ent/start", { inviteToken });
  const st = r.j?.status || r.j?.state;
  if (r.status === 200 && st) everLeased = true;
  if (r.status === 200 && (r.j?.consoleUrl || r.j?.url)) { active = true; consoleUrl = r.j.consoleUrl || r.j.url; break; }
  const tag = r.status === 503 ? "NO_CAPACITY(warming)" : `status=${r.status} state=${st}`;
  if (i % 3 === 0) process.stdout.write(`    start poll ${i}: ${tag}\n`);
  await sleep(6000);
}
ok("BUG2/4 start leased + console minted", active && !!consoleUrl, `active=${active} console=${consoleUrl ? "yes" : "no"}`);

// submit -> grade + teardown (BUG 3: nuke must run)
r = await call("POST", "/ent/submit", { inviteToken, reflection: "E2E full-loop reflection.", auto: false });
ok("submit 200", r.status === 200, `status ${r.status}`);

// give teardown time to nuke + release, then confirm account back in pool
console.log("  (waiting for teardown/nuke ~ up to 6 min)");
let released = false, acctId = null;
r = await call("GET", `/ent/invite?inviteToken=${inviteToken}`);
acctId = "350823026476"; // the sole reserved ent account
for (let i = 0; i < 70; i++) {
  const a = await db.send(new GetItemCommand({ TableName: "ShieldSyncLabAccounts", Key: { accountId: { S: acctId } } }));
  const status = a.Item?.status?.S;
  if (status === "available" || status === "warming") { released = true; break; }
  if (i % 5 === 0) process.stdout.write(`    account poll ${i}: status=${status}\n`);
  await sleep(6000);
}
ok("BUG3 account released after teardown (nuke ran)", released, `acct ${acctId}`);

console.log(`\n==== FULL LOOP: ${pass} passed, ${fail} failed ====`);
if (fails.length) fails.forEach((f) => console.log("  - " + f));
console.log(`orgId=${orgId} assessmentId=${assessmentId} inviteToken=${inviteToken}`);
process.exit(fail ? 1 : 0);
