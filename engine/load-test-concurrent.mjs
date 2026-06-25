// REAL concurrent cold-launch stress test against the live engine + pool.
//
// Fires N simultaneous /launch for the IAM lab (the warmer only pre-warms the FREE
// lab, so IAM forces genuine COLD CloudFormation deploys). With a 3-account pool and
// N>3 this exercises, all at once:
//   • concurrent leasing atomicity — exactly poolSize win, NONE double-lease
//   • overflow handling — the rest get a clean 503 NO_CAPACITY (no crash)
//   • concurrent COLD deploys — watch for CREATE_FAILED / CFN throttling, record time
//   • concurrent teardown — fire all teardowns at once, watch for races / stuck accounts
//   • pool restoration — every account returns to `available`
//
// Real resources are created (IAM lab ≈ a few ₹, no EC2) and TORN DOWN in a finally.
// Uses distinct fresh user ids so nobody's rate counter is touched. Run from engine/:
//   node load-test-concurrent.mjs            # default N=5
//   node load-test-concurrent.mjs 5

import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { LambdaClient, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const ACCOUNTS = "ShieldSyncLabAccounts";
const COLD_LAB = "iam-privilege-escalation"; // not pre-warmed → always a cold deploy
const N = Number(process.argv[2] ?? "5");
const BASE = (process.env.ENGINE_URL ?? "https://lewssnjjhi.execute-api.us-east-1.amazonaws.com").replace(/\/+$/, "");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✅ ${m}`); } else { fail++; console.log(`  ❌ ${m}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sts = new STSClient({ region: REGION });
const cr = (await sts.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`, RoleSessionName: "cc-loadtest" }))).Credentials;
const creds = { accessKeyId: cr.AccessKeyId, secretAccessKey: cr.SecretAccessKey, sessionToken: cr.SessionToken };
const db = new DynamoDBClient({ region: REGION, credentials: creds });
const lam = new LambdaClient({ region: REGION, credentials: creds });

const secret = (await lam.send(new GetFunctionConfigurationCommand({ FunctionName: "ShieldSyncEngine" }))).Environment.Variables.ENGINE_SHARED_SECRET;
const H = (uid) => ({ "content-type": "application/json", "x-engine-token": secret, "x-user-id": uid });

async function poolState() {
  const r = await db.send(new ScanCommand({ TableName: ACCOUNTS }));
  const items = r.Items ?? [];
  const by = (s) => items.filter((i) => i.status?.S === s).map((i) => i.accountId.S);
  return { total: items.length, available: by("available"), leased: by("leased"), other: items.filter((i) => !["available", "leased"].includes(i.status?.S)).map((i) => `${i.accountId.S}:${i.status?.S}`) };
}

const stamp = Date.now();
const users = Array.from({ length: N }, (_, i) => `loadtest-cc-${i}-${stamp}`);
const leasedSessions = []; // {sessionId, user} — torn down in finally

try {
  const base0 = await poolState();
  console.log(`\nPool: ${base0.total} accounts · available=${base0.available.length} leased=${base0.leased.length}${base0.other.length ? " other=" + base0.other.join(",") : ""}`);
  const cap = base0.available.length;
  if (cap < 1) { console.log("No available accounts — aborting (pool busy)."); process.exit(1); }
  console.log(`Firing ${N} SIMULTANEOUS cold /launch (${COLD_LAB}); pool can satisfy ${cap}.\n`);

  // ── fire N launches truly concurrently ────────────────────────────────────
  const t0 = Date.now();
  const launches = await Promise.all(users.map(async (u) => {
    try {
      const r = await fetch(`${BASE}/launch`, { method: "POST", headers: H(u), body: JSON.stringify({ labSlug: COLD_LAB }) });
      const body = await r.json().catch(() => ({}));
      return { u, status: r.status, body, ms: Date.now() - t0 };
    } catch (e) { return { u, status: 0, error: String(e) }; }
  }));

  const leased = launches.filter((r) => r.status === 200);
  const rejected = launches.filter((r) => r.status === 503);
  const errored = launches.filter((r) => r.status !== 200 && r.status !== 503);
  leased.forEach((r) => leasedSessions.push({ sessionId: r.body.sessionId, user: r.u }));

  console.log("Test 1 — concurrent lease + overflow:");
  ok(leased.length === cap, `exactly ${cap} leased (got ${leased.length})`);
  ok(rejected.length === N - cap, `the other ${N - cap} got 503 NO_CAPACITY (got ${rejected.length})`);
  ok(rejected.every((r) => r.body.error === "NO_CAPACITY"), `every overflow = NO_CAPACITY (${[...new Set(rejected.map((r) => r.body.error))].join(",") || "—"})`);
  ok(errored.length === 0, `no 5xx/crashes (${errored.length} errored)`);
  ok(leased.every((r) => r.body.warm === false), `all leases were COLD (warm=false)`);

  // distinct accounts? (no double-lease) — read each session's accountId
  const sess = await Promise.all(leasedSessions.map(async (s) => {
    const r = await fetch(`${BASE}/session/${s.sessionId}`, { headers: H(s.user) });
    return r.ok ? r.json() : {};
  }));
  const accts = sess.map((s) => s.accountId).filter(Boolean);
  ok(new Set(accts).size === accts.length && accts.length === leased.length, `each lease got a DISTINCT account — no double-lease (${accts.join(", ")})`);

  // ── poll each leased session to active (cold deploy) ──────────────────────
  console.log("\nTest 2 — concurrent COLD deploys reach active (watch CREATE_FAILED / throttle):");
  const deadline = Date.now() + 240000; // 4 min
  const done = {};
  while (Date.now() < deadline && Object.keys(done).length < leasedSessions.length) {
    await sleep(6000);
    for (const s of leasedSessions) {
      if (done[s.sessionId]) continue;
      const r = await fetch(`${BASE}/session/${s.sessionId}`, { headers: H(s.user) });
      const d = r.ok ? await r.json() : {};
      if (d.status === "active") { done[s.sessionId] = { ok: true, ms: Date.now() - t0 }; console.log(`  ✅ ${s.sessionId} ACTIVE after ${Math.round((Date.now() - t0) / 1000)}s (${d.accountId})`); }
      else if (d.status === "error") { done[s.sessionId] = { ok: false, err: d.error }; console.log(`  ❌ ${s.sessionId} ERROR: ${d.error || "(deploy failed)"}`); }
    }
  }
  ok(Object.values(done).length === leasedSessions.length, `all ${leasedSessions.length} deploys resolved within 4 min (${Object.keys(done).length} did)`);
  ok(Object.values(done).every((d) => d.ok), `all cold deploys SUCCEEDED — no CREATE_FAILED`);

  // ── concurrent teardown (race test) ───────────────────────────────────────
  console.log("\nTest 3 — fire all teardowns SIMULTANEOUSLY (race + stuck-account check):");
  const td = await Promise.all(leasedSessions.map(async (s) => {
    const r = await fetch(`${BASE}/teardown`, { method: "POST", headers: H(s.user), body: JSON.stringify({ sessionId: s.sessionId }) });
    return r.status;
  }));
  ok(td.every((s) => s === 200), `all teardowns accepted (${td.join(",")})`);
  leasedSessions.length = 0; // teardown issued for all → finally has nothing extra to do

  // poll pool back to baseline available
  const tdDeadline = Date.now() + 480000; // 8 min for concurrent aws-nuke
  let restored = false;
  while (Date.now() < tdDeadline) {
    await sleep(15000);
    const p = await poolState();
    process.stdout.write(`  pool: available=${p.available.length} leased=${p.leased.length}${p.other.length ? " other=" + p.other.join(",") : ""}\n`);
    if (p.available.length >= base0.available.length && p.leased.length === 0) { restored = true; break; }
  }
  ok(restored, `pool fully restored to ${base0.available.length} available, 0 leased, 0 stuck`);
} finally {
  // safety net: tear down anything still leased (e.g. if an assertion threw early)
  if (leasedSessions.length) {
    console.log(`\nCleanup — tearing down ${leasedSessions.length} leftover session(s)…`);
    for (const s of leasedSessions) {
      await fetch(`${BASE}/teardown`, { method: "POST", headers: H(s.user), body: JSON.stringify({ sessionId: s.sessionId }) }).catch(() => {});
    }
    console.log("  (teardown issued; reaper backstops any that fail)");
  }
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
