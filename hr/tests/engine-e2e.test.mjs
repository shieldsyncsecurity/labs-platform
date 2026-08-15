// End-to-end walk of the HR data plane: candidate -> questionnaire -> hire ->
// employee -> documents -> payroll -> banking -> permissions -> audit.
//
// Runs against the LOCAL dev engine on a throwaway port and a throwaway data
// directory (HR_DEV_DATA_DIR), so it never touches real candidate or payroll
// data. The dev engine mirrors the production Lambda's /hr/* contract, so a
// contract break here is a contract break there.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dir, "..", "..", "engine", "hr-server.mjs");
// NO fixed port. A hardcoded one made this suite flaky: if a previous run's engine
// was still holding it, the fresh spawn died on EADDRINUSE while /hr/health kept
// answering from the STALE process — so tests silently ran against leftover data and
// a different assertion failed each run. We now ask for an OS-assigned port (0) and
// read the real one back from the engine's startup line.
const TOKEN = "e2e-secret";
let BASE;
let proc;
let dataDir;

const H = { "content-type": "application/json", "x-engine-token": TOKEN };
async function api(pathname, opts = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: opts.method ?? "GET",
    headers: H,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hr-e2e-"));
  proc = spawn(process.execPath, [ENGINE], {
    // Port 0 = OS picks a free one, so concurrent/back-to-back runs can't collide.
    env: { ...process.env, HR_ENGINE_PORT: "0", HR_ENGINE_SECRET: TOKEN, HR_DEV_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Learn the real port from THIS process's startup line — guarantees we're talking
  // to the engine we just spawned, never a stale one someone left running.
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dev engine did not report a port in 15s")), 15000);
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/listening on http:\/\/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    let errBuf = "";
    proc.stderr.on("data", (d) => { errBuf += d.toString(); });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dev engine exited (code ${code}) before listening: ${errBuf.trim() || "no stderr"}`));
    });
  });
  BASE = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/hr/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("dev engine did not answer /hr/health");
});

after(() => {
  proc?.kill();
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// --- Authentication ---------------------------------------------------------

test("rejects a request with no engine token", async () => {
  const res = await fetch(`${BASE}/hr/employees`);
  assert.equal(res.status, 401);
});

test("rejects a request with the wrong engine token", async () => {
  const res = await fetch(`${BASE}/hr/employees`, { headers: { "x-engine-token": "wrong" } });
  assert.equal(res.status, 401);
});

// --- Candidate lifecycle ----------------------------------------------------

let candSeq;
let rawToken;

test("creates a candidate and allocates a reference", async () => {
  const { status, body } = await api("/hr/candidates", {
    method: "POST",
    body: { candidate: { name: "E2E Tester", email: "e2e@example.com", roleAppliedFor: "Executive Assistant", outcome: "pending" }, actor: "admin@test" },
  });
  assert.equal(status, 200);
  assert.match(body.candidate.candidateId, /^SSS\/CAND\/\d{4}$/);
  candSeq = body.candidate.seq;
});

test("issues a questionnaire link", async () => {
  const { status, body } = await api(`/hr/candidates/${candSeq}/token`, { method: "POST", body: { validDays: 2, actor: "admin@test" } });
  assert.equal(status, 200);
  assert.ok(body.token.startsWith(`${candSeq}.`));
  rawToken = body.token;
});

test("stores only the token HASH, never the raw token", async () => {
  const { body } = await api(`/hr/candidates/${candSeq}`);
  const secret = rawToken.split(".")[1];
  assert.ok(body.candidate.tokenHash, "expected a hash on the record");
  assert.notEqual(body.candidate.tokenHash, secret);
  assert.ok(!JSON.stringify(body.candidate).includes(secret), "raw token must never be persisted");
});

test("a staff preview does NOT count as a candidate open", async () => {
  await api(`/hr/questionnaire/${rawToken}?preview=1`);
  await api(`/hr/questionnaire/${rawToken}?preview=1`);
  const { body } = await api(`/hr/candidates/${candSeq}`);
  assert.equal(body.candidate.viewCount ?? 0, 0);
});

test("a real candidate open is counted and timestamped", async () => {
  await api(`/hr/questionnaire/${rawToken}`);
  const { body } = await api(`/hr/candidates/${candSeq}`);
  assert.equal(body.candidate.viewCount, 1);
  assert.ok(body.candidate.firstViewedAt);
  assert.ok(body.candidate.lastViewedAt);
});

test("the public questionnaire view leaks nothing beyond the candidate's own data", async () => {
  const { body } = await api(`/hr/questionnaire/${rawToken}`);
  const keys = Object.keys(body.candidate);
  for (const forbidden of ["email", "phone", "notes", "outcome", "outcomeNote", "tokenHash", "seq", "candidateId"]) {
    assert.ok(!keys.includes(forbidden), `public view must not expose ${forbidden}`);
  }
});

test("a wrong token is rejected", async () => {
  const { status } = await api(`/hr/questionnaire/${candSeq}.${"0".repeat(48)}`);
  assert.equal(status, 404);
});

test("accepts the candidate's submission", async () => {
  const { status } = await api(`/hr/questionnaire/${rawToken}`, { method: "POST", body: { answers: { dressCode: "Yes, happy to be told the dress code", peerPartnership: "Sounds good." } } });
  assert.equal(status, 200);
  const { body } = await api(`/hr/candidates/${candSeq}`);
  assert.ok(body.candidate.submittedAt);
  assert.equal(body.candidate.answers.dressCode, "Yes, happy to be told the dress code");
});

test("refuses a SECOND submission on the same link", async () => {
  const { status } = await api(`/hr/questionnaire/${rawToken}`, { method: "POST", body: { answers: { dressCode: "changed my mind" } } });
  assert.equal(status, 409);
  const { body } = await api(`/hr/candidates/${candSeq}`);
  assert.equal(body.candidate.answers.dressCode, "Yes, happy to be told the dress code", "answers must not be overwritten");
});

test("revoking a link kills it but keeps the answers", async () => {
  const { status } = await api(`/hr/candidates/${candSeq}/token`, { method: "DELETE", body: { actor: "admin@test" } });
  assert.equal(status, 200);
  const dead = await api(`/hr/questionnaire/${rawToken}`);
  assert.equal(dead.status, 404);
  const { body } = await api(`/hr/candidates/${candSeq}`);
  assert.ok(body.candidate.answers, "revocation must not destroy submitted answers");
  assert.ok(!body.candidate.tokenHash);
});

test("editing a candidate cannot forge submission state or reset open tracking", async () => {
  // Read the real count first: other tests open the link too, so asserting a
  // hardcoded number would make this pass or fail on test ORDER rather than on
  // whether the engine actually protects the field.
  const before = (await api(`/hr/candidates/${candSeq}`)).body.candidate.viewCount;
  const { body } = await api(`/hr/candidates/${candSeq}`, {
    method: "PUT",
    body: { candidate: { name: "E2E Tester", email: "e2e@example.com", roleAppliedFor: "Executive Assistant", outcome: "shortlisted", submittedAt: null, answers: {}, viewCount: 999, candidateId: "SSS/CAND/9999" }, actor: "admin@test" },
  });
  assert.equal(body.candidate.outcome, "shortlisted", "editable field should change");
  assert.ok(body.candidate.submittedAt, "submittedAt is engine-owned");
  assert.equal(body.candidate.viewCount, before, "view tracking is engine-owned");
  assert.notEqual(body.candidate.candidateId, "SSS/CAND/9999", "reference is engine-owned");
});

// --- Employees, documents, payroll ------------------------------------------

let empSeq;

test("creates an employee with a sequential reference", async () => {
  const { status, body } = await api("/hr/employees", {
    method: "POST",
    body: { employee: { name: "E2E Employee", designation: "GRC Analyst", department: "GRC", dateOfJoining: "01 August 2026", employmentType: "Full-time, permanent", grossMonthly: 30000, annualCTC: 360000, structure: { basic: 15000, hra: 6000, conveyance: 1600, special: 7400, gross: 30000 }, status: "active" }, actor: "admin@test" },
  });
  assert.equal(status, 200);
  assert.match(body.employee.employeeId, /^SSS\/EMP\/\d{4}$/);
  empSeq = body.employee.seq;
});

test("issues a document and allocates a unique reference from the series", async () => {
  const a = await api(`/hr/employees/${empSeq}/generated`, { method: "POST", body: { docType: "letter", title: "Verification", refSeries: "hr", refYear: 2026, snapshot: { hello: "world" }, actor: "admin@test" } });
  const b = await api(`/hr/employees/${empSeq}/generated`, { method: "POST", body: { docType: "letter", title: "Verification 2", refSeries: "hr", refYear: 2026, snapshot: { hello: "world" }, actor: "admin@test" } });
  assert.match(a.body.gen.ref, /^SSS\/HR\/2026\/\d{3}$/);
  assert.notEqual(a.body.gen.ref, b.body.gen.ref, "references must never repeat");
});

test("an issued document re-renders from its frozen snapshot", async () => {
  const made = await api(`/hr/employees/${empSeq}/generated`, { method: "POST", body: { docType: "payslip", title: "Salary Slip - August 2026", ref: `SSS/EMP/${empSeq} 2026-08`, snapshot: { netPay: 30000, employee: { name: "E2E Employee" } }, actor: "admin@test" } });
  const got = await api(`/hr/employees/${empSeq}/generated/${made.body.gen.docId}`);
  assert.equal(got.body.gen.snapshot.netPay, 30000);
});

test("changing salary does NOT rewrite an already-issued payslip", async () => {
  await api(`/hr/employees/${empSeq}`, {
    method: "PUT",
    body: { employee: { name: "E2E Employee", designation: "GRC Analyst", department: "GRC", dateOfJoining: "01 August 2026", employmentType: "Full-time, permanent", grossMonthly: 50000, annualCTC: 600000, structure: { basic: 25000, hra: 10000, conveyance: 1600, special: 13400, gross: 50000 }, status: "active" }, actor: "admin@test" },
  });
  const list = await api(`/hr/employees/${empSeq}/generated`);
  const slip = list.body.generated.find((g) => g.docType === "payslip");
  const got = await api(`/hr/employees/${empSeq}/generated/${slip.docId}`);
  assert.equal(got.body.gen.snapshot.netPay, 30000, "issued documents are historical records, not live views");
});

// --- Banking ----------------------------------------------------------------

const txn = (id, over = {}) => ({ txnId: id, date: "2026-08-01", month: "2026-08", particulars: "TEST", counterparty: "TEST CO", credit: 1000, debit: 0, balance: 1000, category: "other", ...over });

test("imports transactions", async () => {
  const { body } = await api("/hr/banking", { method: "POST", body: { transactions: [txn("t_a"), txn("t_b")], actor: "admin@test" } });
  assert.equal(body.created, 2);
});

test("re-importing an overlapping statement updates instead of duplicating", async () => {
  const { body } = await api("/hr/banking", { method: "POST", body: { transactions: [txn("t_b"), txn("t_c")], actor: "admin@test" } });
  assert.equal(body.created, 1);
  assert.equal(body.updated, 1);
  const all = await api("/hr/banking");
  assert.equal(all.body.transactions.length, 3, "no duplicates from an overlapping import");
});

test("a hand-set category survives a re-import", async () => {
  await api("/hr/banking/t_a", { method: "PUT", body: { category: "loan", note: "from mum", actor: "admin@test" } });
  await api("/hr/banking", { method: "POST", body: { transactions: [txn("t_a")], actor: "admin@test" } });
  const all = await api("/hr/banking");
  const t = all.body.transactions.find((x) => x.txnId === "t_a");
  assert.equal(t.category, "loan", "re-import must not clobber a human classification");
  assert.equal(t.note, "from mum", "re-import must not clobber a remark");
});

test("deletes a single transaction", async () => {
  await api("/hr/banking/t_c", { method: "DELETE", body: { actor: "admin@test" } });
  const all = await api("/hr/banking");
  assert.equal(all.body.transactions.length, 2);
});

// --- Permissions ------------------------------------------------------------

test("permissions default to nothing granted", async () => {
  const { body } = await api("/hr/access");
  assert.deepEqual(body.grants, {});
});

test("stores and clears a permission grant", async () => {
  const set = await api("/hr/access", {
    method: "PUT",
    body: { email: "hr@test", access: { areas: { candidates: "write", employees: "read", documents: "none", payroll: "none", kyc: "none", banking: "none", audit: "none" }, seeSalary: false, seeBankDetails: false }, actor: "admin@test" },
  });
  assert.equal(set.body.grants["hr@test"].areas.candidates, "write");
  const cleared = await api("/hr/access", { method: "PUT", body: { email: "hr@test", access: null, actor: "admin@test" } });
  assert.deepEqual(cleared.body.grants, {});
});

test("the permission record never surfaces as an employee", async () => {
  await api("/hr/access", { method: "PUT", body: { email: "hr@test", access: { areas: {}, seeSalary: false, seeBankDetails: false }, actor: "admin@test" } });
  const { body } = await api("/hr/employees");
  assert.ok(body.employees.every((e) => e.seq > 0 && e.name), "reserved keys must not appear in the roster");
});

// --- Audit ------------------------------------------------------------------

test("every mutation is audited", async () => {
  const { body } = await api("/hr/audit?limit=500");
  const actions = new Set(body.audit.map((a) => a.action));
  for (const expected of ["candidate.create", "candidate.link", "candidate.link.revoke", "questionnaire.submit", "employee.create", "doc.generate", "banking.import", "access.update"]) {
    assert.ok(actions.has(expected), `missing audit action: ${expected}`);
  }
});

test("a staff preview is audited separately from a candidate open", async () => {
  const { body } = await api("/hr/audit?limit=500");
  const actions = body.audit.map((a) => a.action);
  assert.ok(actions.includes("questionnaire.preview"), "staff previews must be distinguishable");
  assert.ok(actions.includes("questionnaire.view"), "candidate opens must be recorded");
});
