// Azure analog of ent-fullloop-test.mjs — proves the DEPLOYED enterprise engine
// dispatches an "azure"-track lab through azure-infra.mjs end to end, in the real
// Lambda (not the standalone try-azure-lab harness):
//
//   create org + AZURE assessment (storage-public-exposure-audit) + invite
//     -> consent -> (OTP bypass via a direct DDB status write, same sanctioned
//        mechanism ent-fullloop-test uses) -> slots -> book -> start
//     -> assert the AZURE-shaped start response (status "leasing",
//        accessPending:true, a portal.azure.com consoleUrl)
//     -> poll the invite ROW in DDB until the async deploy-azure worker stamps
//        azResourceGroup (azLease ran in-Lambda) then azStorageAccount + azReady
//        (the deploy-azure worker deployed+seeded via the bundled @azure SDKs +
//        the AZURE_* Lambda env — the bits that only exist in the deployed fn)
//     -> submit -> teardown-azure -> assert invite went "submitted".
//
// This exercises exactly what the standalone try-azure-lab CANNOT: entLabTrack()
// reading lab.json from the bundled labs/ tree, the @azure node_modules closure
// resolving inside /var/task, and the mgmt/probe SP auth from the Lambda env.
//
// Needs ENT_SECRET + AWS creds assumed into 750 (for the DDB bypass/observe),
// same as ent-fullloop-test.mjs. Leases real Azure (~Rs0) and tears itself down.
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";

const BASE = "https://bdkdcbhzme.execute-api.us-east-1.amazonaws.com";
const SECRET = process.env.ENT_SECRET;
const LAB = "storage-public-exposure-audit";
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
console.log("=== AZURE ENGINE DISPATCH (real lease, via deployed Lambda) ===");
r = await call("POST", "/ent/orgs", { name: "E2E Azure Dispatch", creditsTotal: 3, actor: "az-dispatch" });
const orgId = r.j.orgId; ok("org create", r.status === 200);
r = await call("POST", "/ent/assessments", { orgId, name: "AzDispatch", labSlug: LAB, actor: "az-dispatch" });
const assessmentId = r.j.assessmentId; ok("azure assessment create", r.status === 200, `status ${r.status}`);
const inviteToken = "az" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
r = await call("POST", "/ent/invites", { assessmentId, orgId, candidateName: "Az Cand", candidateEmail: "delivered@resend.dev", inviteToken, actor: "az-dispatch" });
ok("invite create + credit", r.status === 200 && r.j.creditConsumed === true, `status ${r.status}`);
r = await call("POST", "/ent/consent", { inviteToken, consentVersion: "v1" });
ok("consent", r.status === 200, `status ${r.status}`);

// OTP bypass: consented -> verified via a direct DDB write (Lambda never returns the code)
await db.send(new UpdateItemCommand({
  TableName: "ShieldSyncEntInvites", Key: { inviteToken: { S: inviteToken } },
  UpdateExpression: "SET #s = :v", ConditionExpression: "#s = :c",
  ExpressionAttributeNames: { "#s": "status" }, ExpressionAttributeValues: { ":v": { S: "verified" }, ":c": { S: "consented" } },
}));
console.log("  (OTP bypassed: invite -> verified via DDB)");

r = await call("POST", "/ent/slots", { inviteToken });
ok("slots 200 (azure fixed cap, no AWS pool)", r.status === 200 && r.j.capacity > 0, `cap ${r.j?.capacity}`);
const slotKey = new Date(Date.now() + (3 + Math.floor(Math.random() * 500)) * 36e5).toISOString().slice(0, 13) + ":00:00.000Z";
r = await call("POST", "/ent/book", { inviteToken, slotKey });
ok("book 200 (azure branch, no entReservedCounts)", r.status === 200, `status ${r.status} ${JSON.stringify(r.j).slice(0, 80)}`);

r = await call("POST", "/ent/start", { inviteToken });
ok("start 200 + azure-shaped (accessPending)", r.status === 200 && r.j.accessPending === true, `status ${r.status} ${JSON.stringify(r.j).slice(0, 140)}`);
ok("start consoleUrl -> portal.azure.com", typeof r.j?.consoleUrl === "string" && r.j.consoleUrl.includes("portal.azure.com"), r.j?.consoleUrl);
ok("start status leasing/active", ["leasing", "active"].includes(r.j?.status), `status=${r.j?.status}`);

// Poll the invite row for the async deploy-azure worker's stamps.
let rg = null, sa = null, ready = false, azErr = null;
for (let i = 0; i < 40; i++) {
  const it = await db.send(new GetItemCommand({ TableName: "ShieldSyncEntInvites", Key: { inviteToken: { S: inviteToken } } }));
  rg = it.Item?.azResourceGroup?.S || rg;
  sa = it.Item?.azStorageAccount?.S || sa;
  ready = it.Item?.azReady?.BOOL === true || ready;
  azErr = it.Item?.azError?.S || azErr;
  if (i % 3 === 0) console.log(`    deploy poll ${i}: rg=${rg || "-"} sa=${sa || "-"} ready=${ready} err=${azErr || "-"}`);
  if ((ready && sa) || azErr) break;
  await sleep(6000);
}
ok("azLease stamped RG on invite (dispatch reached azure-infra in-Lambda)", !!rg, `rg=${rg}`);
ok("deploy-azure worker deployed+seeded (storage account + ready, no error)", !!sa && ready && !azErr, `sa=${sa} ready=${ready} err=${azErr}`);

// submit -> azGrade (broken scenario, expect not-passing) + teardown-azure
r = await call("POST", "/ent/submit", { inviteToken, reflection: "E2E azure dispatch reflection.", auto: false });
ok("submit 200", r.status === 200, `status ${r.status} ${JSON.stringify(r.j).slice(0, 140)}`);
const it2 = await db.send(new GetItemCommand({ TableName: "ShieldSyncEntInvites", Key: { inviteToken: { S: inviteToken } } }));
ok("invite -> submitted", it2.Item?.status?.S === "submitted", `status ${it2.Item?.status?.S}`);

console.log(`\n==== AZURE DISPATCH: ${pass} passed, ${fail} failed ====`);
if (fails.length) fails.forEach((f) => console.log("  - " + f));
console.log(`orgId=${orgId} assessmentId=${assessmentId} inviteToken=${inviteToken} rg=${rg}`);
console.log(`(verify teardown separately: az group show -n ${rg} should 404 within ~1-2 min)`);
process.exit(fail ? 1 : 0);
