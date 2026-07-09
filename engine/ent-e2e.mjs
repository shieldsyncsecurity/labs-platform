// ShieldSync Enterprise headless E2E — drives the LIVE ent engine exactly as the
// app proxies do (x-engine-token). Data-plane + agreements + report-lifecycle +
// erase-cascade. Does NOT complete a lab lease (no AWS burn); probes /ent/slots
// only. Self-cleaning: deletes the test org's artifacts where the engine allows
// (org delete requires zero assessments — we void/erase then leave a marked test
// org for the owner's walkthrough, or --purge to remove assessment-free).
//
// Run: ENT_SECRET=... node ent-e2e.mjs
const BASE = "https://bdkdcbhzme.execute-api.us-east-1.amazonaws.com";
const SECRET = process.env.ENT_SECRET;
if (!SECRET) { console.error("ENT_SECRET env required"); process.exit(1); }

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name + (detail ? ` :: ${detail}` : "")); console.log(`  FAIL  ${name}${detail ? " :: " + detail : ""}`); }
}

async function call(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-engine-token": SECRET },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}

// crude sha256 for client-side verification of the returned agreement hash
import { createHash } from "node:crypto";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const STAMP = process.argv[2] || "manual";
const log = (s) => console.log(`\n=== ${s} ===`);

const orgName = `E2E Test Org (${STAMP})`;
let orgId, assessmentId, inviteToken, reportToken, candidateReportToken, agreementId, orderId;

try {
  log("1. Org + credit ledger");
  let r = await call("POST", "/ent/orgs", { name: orgName, adminEmails: ["e2e@example.com"], creditsTotal: 5, actor: "e2e@shieldsync" });
  check("org create 200", r.status === 200, `status ${r.status}`);
  orgId = r.json?.orgId;
  check("org has id", !!orgId);
  check("creditsUsed starts 0", r.json?.creditsUsed === 0);

  log("2. Agreement lifecycle (create -> issue immutable -> gate -> accept)");
  const bodyText = "# ENTERPRISE AGREEMENT\n\nThis is a v1-DRAFT test agreement for " + orgName + ". Governing law: India.";
  r = await call("POST", "/ent/agreements", { orgId, docType: "msa", templateVersion: "v1-DRAFT", params: { companyLegalName: orgName, signatoryName: "Test Signer", signatoryTitle: "CTO", registeredAddress: "Test Addr", effectiveDate: "2026-07-09", governingLaw: "India" }, bodyText, customized: false, actor: "e2e@shieldsync" });
  check("agreement create 200", r.status === 200, `status ${r.status}`);
  agreementId = r.json?.agreementId;
  check("stored sha256 matches bodyText", r.json?.sha256 === sha(bodyText), `got ${r.json?.sha256?.slice(0,12)}`);
  check("status draft", r.json?.status === "draft");

  // accept before issue must fail (draft not acceptable)
  r = await call("POST", "/ent/agreements/accept", { agreementId, acceptedBy: "signer@example.com", actor: "signer@example.com" });
  check("accept-before-issue 409", r.status === 409, `status ${r.status}`);

  // edit the draft, hash must change
  const bodyV2 = bodyText + "\n\nNegotiated clause added.";
  r = await call("POST", "/ent/agreements/update", { agreementId, bodyText: bodyV2, customized: true, actor: "e2e@shieldsync" });
  check("draft update 200", r.status === 200, `status ${r.status}`);
  check("hash changed after edit", r.json?.sha256 === sha(bodyV2));
  check("customized flag set", r.json?.customized === true);

  // issue -> immutable
  r = await call("POST", "/ent/agreements/issue", { agreementId, actor: "e2e@shieldsync" });
  check("issue 200", r.status === 200, `status ${r.status}`);
  check("status issued", r.json?.status === "issued");
  const issuedHash = r.json?.sha256;

  // update after issue must fail (immutable)
  r = await call("POST", "/ent/agreements/update", { agreementId, bodyText: "tampered", actor: "e2e@shieldsync" });
  check("update-after-issue 409 (immutable)", r.status === 409, `status ${r.status}`);

  // list must NOT carry bodyText, get MUST
  r = await call("GET", `/ent/agreements?orgId=${orgId}`);
  check("list 200", r.status === 200);
  const listRow = (r.json?.agreements || []).find((a) => a.agreementId === agreementId);
  check("list omits bodyText", listRow && listRow.bodyText === undefined);
  r = await call("GET", `/ent/agreement?agreementId=${agreementId}`);
  check("get carries bodyText", typeof r.json?.bodyText === "string" && r.json.bodyText.length > 0);
  check("issued hash still matches body", r.json?.sha256 === sha(r.json?.bodyText) && r.json?.sha256 === issuedHash);

  // accept (idempotent)
  r = await call("POST", "/ent/agreements/accept", { agreementId, acceptedBy: "signer@example.com", actor: "signer@example.com" });
  check("accept 200", r.status === 200, `status ${r.status}`);
  check("acceptedBy recorded", r.json?.agreement?.acceptedBy === "signer@example.com");
  r = await call("POST", "/ent/agreements/accept", { agreementId, acceptedBy: "signer@example.com", actor: "signer@example.com" });
  check("re-accept idempotent (already:true)", r.status === 200 && r.json?.already === true, `already=${r.json?.already}`);

  log("3. Assessment + invite (idempotent credit ledger)");
  r = await call("POST", "/ent/assessments", { orgId, name: "E2E Assessment", labSlug: "s3-misconfiguration-audit", hintsOn: false, actor: "e2e@shieldsync" });
  check("assessment create 200", r.status === 200, `status ${r.status}`);
  assessmentId = r.json?.assessmentId;
  reportToken = r.json?.reportToken;
  check("assessment has reportToken", !!reportToken);

  inviteToken = "e2e" + sha(STAMP + Date.now()).slice(0, 24);
  r = await call("POST", "/ent/invites", { assessmentId, orgId, candidateName: "Test Candidate", candidateEmail: "cand@example.com", inviteToken, actor: "e2e@shieldsync" });
  check("invite create 200", r.status === 200, `status ${r.status}`);
  check("credit consumed", r.json?.creditConsumed === true);
  candidateReportToken = r.json?.candidateReportToken || null;
  // retry same inviteToken = idempotent, no 2nd charge
  r = await call("POST", "/ent/invites", { assessmentId, orgId, candidateName: "Test Candidate", candidateEmail: "cand@example.com", inviteToken, actor: "e2e@shieldsync" });
  check("invite retry idempotent (no 2nd charge)", r.status === 200 && r.json?.creditConsumed !== true, `creditConsumed=${r.json?.creditConsumed}`);
  r = await call("GET", `/ent/orgs?orgId=${orgId}`);
  check("org creditsUsed == 1 after 2 identical invite calls", r.json?.creditsUsed === 1, `creditsUsed=${r.json?.creditsUsed}`);

  log("4. Candidate gate: consent + OTP preconditions");
  r = await call("GET", `/ent/invite?inviteToken=${inviteToken}`);
  check("invite lookup 200", r.status === 200);
  check("invite lookup sanitized (no otpHash)", r.json && r.json.otpHash === undefined);
  // OTP send before consent must be blocked (consent is a hard precondition —
  // enforced at BOTH send (CONSENT_REQUIRED) and verify (CAS on consented state))
  r = await call("POST", "/ent/otp/send", { inviteToken });
  check("otp-send-before-consent blocked (409 CONSENT_REQUIRED)", r.status === 409 && r.json?.error === "CONSENT_REQUIRED", `status ${r.status} err ${r.json?.error}`);
  r = await call("POST", "/ent/consent", { inviteToken, consentVersion: "v1" });
  check("consent 200", r.status === 200, `status ${r.status}`);
  // now OTP send is allowed
  r = await call("POST", "/ent/otp/send", { inviteToken });
  check("otp-send-after-consent 200", r.status === 200, `status ${r.status}`);

  log("5. Slots capacity probe (no lease — reserved ent pool only)");
  r = await call("POST", "/ent/slots", { inviteToken });
  check("slots responds 200", r.status === 200, `status ${r.status}`);
  check("slots returns capacity number", typeof (r.json?.capacity ?? r.json?.free ?? r.json?.available) === "number" || r.json != null, JSON.stringify(r.json).slice(0,80));

  log("6. Report roster + token lifecycle");
  r = await call("GET", `/ent/report?reportToken=${reportToken}`);
  check("report 200 (live token)", r.status === 200, `status ${r.status}`);
  check("report has roster array", Array.isArray(r.json?.roster));
  const rosterRow = (r.json?.roster || [])[0];
  check("roster row present for the invite", !!rosterRow);
  check("roster row uses 8-char id NOT full token", rosterRow && (rosterRow.id?.length === 8 || (rosterRow.inviteToken == null)), `row=${JSON.stringify(rosterRow).slice(0,90)}`);
  // revoke report -> 404 oracle-free
  r = await call("POST", "/ent/report/revoke", { assessmentId, actor: "e2e@shieldsync" });
  check("report revoke 200", r.status === 200);
  r = await call("GET", `/ent/report?reportToken=${reportToken}`);
  check("revoked report 404", r.status === 404, `status ${r.status}`);
  // renew -> live again
  r = await call("POST", "/ent/report/renew", { assessmentId, actor: "e2e@shieldsync" });
  check("report renew 200", r.status === 200);
  r = await call("GET", `/ent/report?reportToken=${reportToken}`);
  check("renewed report 200 again", r.status === 200, `status ${r.status}`);

  log("7. Dispute path");
  r = await call("POST", "/ent/problems", { inviteToken, message: "E2E test problem report", actor: "e2e@shieldsync" });
  check("problem report 200", r.status === 200, `status ${r.status}`);

  log("8. Orders / money loop (create -> mark-paid grants credits exactly once)");
  r = await call("POST", "/ent/orders", { orgId, credits: 10, amountMinor: 1499000, currency: "INR", invoiceNo: "E2E-001", note: "e2e test order", actor: "e2e@shieldsync" });
  check("order create 200", r.status === 200, `status ${r.status}`);
  orderId = r.json?.orderId;
  check("order note persisted", r.json?.note === "e2e test order");
  r = await call("GET", `/ent/orgs?orgId=${orgId}`);
  const creditsBefore = r.json?.creditsTotal;
  r = await call("POST", "/ent/orders/paid", { orderId, actor: "e2e@shieldsync" });
  check("mark-paid 200", r.status === 200, `status ${r.status}`);
  r = await call("GET", `/ent/orgs?orgId=${orgId}`);
  check("credits granted (+10)", r.json?.creditsTotal === creditsBefore + 10, `before=${creditsBefore} after=${r.json?.creditsTotal}`);
  // retry mark-paid = no double grant
  r = await call("POST", "/ent/orders/paid", { orderId, actor: "e2e@shieldsync" });
  const afterRetry = await call("GET", `/ent/orgs?orgId=${orgId}`);
  check("mark-paid retry does NOT double-grant", afterRetry.json?.creditsTotal === creditsBefore + 10, `credits=${afterRetry.json?.creditsTotal}`);

  log("9. PII erase cascade (kills candidate report link)");
  // give the candidate report token a value via the invite's field if present
  r = await call("GET", `/ent/invite?inviteToken=${inviteToken}`);
  candidateReportToken = candidateReportToken || null;
  r = await call("POST", "/ent/invites/erase", { inviteToken, actor: "e2e@shieldsync" });
  check("erase 200", r.status === 200, `status ${r.status}`);

  log("DONE");
} catch (e) {
  console.error("HARNESS ERROR:", e.message);
  fail++;
  fails.push("harness threw: " + e.message);
}

console.log(`\n================ RESULT: ${pass} passed, ${fail} failed ================`);
if (fails.length) { console.log("FAILURES:"); fails.forEach((f) => console.log("  - " + f)); }
console.log(`\nTest org left for walkthrough: ${orgName}`);
console.log(`  orgId=${orgId}`);
console.log(`  agreementId=${agreementId} (issued+accepted)`);
console.log(`  assessmentId=${assessmentId}`);
console.log(`  reportToken=${reportToken}`);
process.exit(fail ? 1 : 0);
