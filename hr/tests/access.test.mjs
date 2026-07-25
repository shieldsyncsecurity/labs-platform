// The permission model and the URL -> permission map. These are the rules the
// middleware enforces on every request, so a mistake here is a data leak rather
// than a cosmetic bug — they deserve tests more than anything else in the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AREAS, assistantPreset, can, fullAccess, noAccess, normalizeAccess } from "./.build/access.mjs";
import { requirementFor } from "./.build/access-routes.mjs";

// --- Model ------------------------------------------------------------------

test("nothing is granted by default", () => {
  const a = noAccess();
  for (const area of AREAS) {
    assert.equal(can(a, area, "read"), false, `${area} must be denied by default`);
    assert.equal(can(a, area, "write"), false);
  }
});

test("write implies read, read does not imply write", () => {
  const a = noAccess();
  a.areas.banking = "read";
  assert.equal(can(a, "banking", "read"), true);
  assert.equal(can(a, "banking", "write"), false);
  a.areas.banking = "write";
  assert.equal(can(a, "banking", "read"), true);
  assert.equal(can(a, "banking", "write"), true);
});

test("full access covers every area", () => {
  const a = fullAccess();
  for (const area of AREAS) assert.equal(can(a, area, "write"), true);
});

test("the assistant preset withholds money, salary and identity documents", () => {
  const a = assistantPreset();
  assert.equal(can(a, "banking", "read"), false, "an EA should not see the company's money by default");
  assert.equal(can(a, "kyc", "read"), false, "Aadhaar/PAN must not be on by default");
  assert.equal(can(a, "audit", "read"), false);
  assert.equal(a.seeSalary, false);
  assert.equal(a.seeBankDetails, false);
  assert.equal(can(a, "candidates", "write"), true, "but recruiting is the job");
});

test("malformed stored permissions fail closed", () => {
  for (const junk of [null, undefined, "admin", 42, [], { areas: "everything" }, { areas: { banking: "superuser" } }]) {
    const a = normalizeAccess(junk);
    for (const area of AREAS) assert.equal(can(a, area, "read"), false, `${JSON.stringify(junk)} must grant nothing`);
    assert.equal(a.seeSalary, false);
    assert.equal(a.seeBankDetails, false);
  }
});

test("only an exact boolean true enables a visibility flag", () => {
  assert.equal(normalizeAccess({ seeSalary: "yes" }).seeSalary, false);
  assert.equal(normalizeAccess({ seeSalary: 1 }).seeSalary, false);
  assert.equal(normalizeAccess({ seeSalary: true }).seeSalary, true);
});

// --- Route map --------------------------------------------------------------

const req = (p, m = "GET") => requirementFor(p, m);

test("the public surface is exactly login, auth, and the candidate questionnaire", () => {
  for (const p of ["/login", "/api/auth/login", "/api/auth/callback", "/q/1.abc", "/api/q/1.abc"]) {
    assert.equal(req(p).kind, "public", `${p} should be public`);
  }
});

test("an unmapped path is administrator-only, not open", () => {
  for (const p of ["/secret-new-page", "/api/something-new", "/employees-export", "/api/v2/employees"]) {
    assert.equal(req(p).kind, "admin", `${p} must fail closed`);
  }
});

test("the permission editor is administrator-only", () => {
  assert.equal(req("/access").kind, "admin");
  assert.equal(req("/api/access", "PUT").kind, "admin");
});

test("reads need read, writes need write", () => {
  assert.deepEqual(req("/api/employees", "GET"), { kind: "area", area: "employees", need: "read" });
  assert.deepEqual(req("/api/employees", "POST"), { kind: "area", area: "employees", need: "write" });
  assert.deepEqual(req("/api/banking", "GET"), { kind: "area", area: "banking", need: "read" });
  assert.deepEqual(req("/api/banking/t_1", "DELETE"), { kind: "area", area: "banking", need: "write" });
});

test("the ID vault is its own permission, separate from employee records", () => {
  assert.deepEqual(req("/api/employees/7/docs", "GET"), { kind: "area", area: "kyc", need: "read" });
  assert.deepEqual(req("/api/employees/7/docs/d_1", "DELETE"), { kind: "area", area: "kyc", need: "write" });
  // Reading an employee record must NOT imply reading their Aadhaar.
  const a = noAccess();
  a.areas.employees = "write";
  assert.equal(can(a, "kyc", "read"), false);
});

test("letters and payroll are separate from the employee record itself", () => {
  assert.deepEqual(req("/employees/7/offer"), { kind: "area", area: "documents", need: "write" });
  assert.deepEqual(req("/employees/7/leave"), { kind: "area", area: "documents", need: "write" });
  assert.deepEqual(req("/employees/7/payslip"), { kind: "area", area: "payroll", need: "write", alsoSeeSalary: true });
  assert.deepEqual(req("/payslips"), { kind: "area", area: "payroll", need: "read" });
  assert.deepEqual(req("/employees/7"), { kind: "area", area: "employees", need: "read" });
});

test("pages that SET pay require the salary permission, not just the area", () => {
  // Masking a figure on a form someone can type into is no protection at all.
  for (const p of ["/employees/new", "/employees/7/edit", "/employees/7/revise", "/employees/7/convert", "/employees/7/payslip"]) {
    assert.equal(req(p).alsoSeeSalary, true, `${p} must require salary visibility`);
  }
  // Reading a record, or writing a non-pay letter, must not.
  for (const p of ["/employees/7", "/employees", "/employees/7/leave", "/employees/7/verification"]) {
    assert.equal(req(p).alsoSeeSalary, undefined, `${p} should not require salary visibility`);
  }
});

test("uploading a statement for review counts as changing banking, not reading it", () => {
  assert.deepEqual(req("/api/banking/parse", "POST"), { kind: "area", area: "banking", need: "write" });
});

test("sending a questionnaire and hiring are writes even though the page is a read", () => {
  assert.deepEqual(req("/api/candidates/1/send", "POST"), { kind: "area", area: "candidates", need: "write" });
  assert.deepEqual(req("/api/candidates/1/hire", "POST"), { kind: "area", area: "candidates", need: "write" });
});

test("the scheduling assistant requires candidate write, not merely read", () => {
  // It proposes interview invites, so it must sit behind the same permission as
  // booking one directly — otherwise the model is a hole in the gate.
  assert.deepEqual(req("/api/assistant", "POST"), { kind: "area", area: "candidates", need: "write" });
});

test("scheduling and cancelling an interview are candidate writes", () => {
  assert.deepEqual(req("/api/candidates/1/interviews", "POST"), { kind: "area", area: "candidates", need: "write" });
  assert.deepEqual(req("/api/candidates/1/interviews/iv_1", "DELETE"), { kind: "area", area: "candidates", need: "write" });
});

test("the Graph diagnostic is administrator-only", () => {
  // It reports the tenant id and which Graph roles were consented.
  assert.equal(req("/api/graph-check").kind, "admin");
});

test("the bulk export is administrator-only, not merely employee-read", () => {
  // It returns every employee, every issued payslip snapshot and all KYC
  // metadata in one file. Anything less than admin would make the salary and
  // bank-detail masking decorative — download it all instead of reading the UI.
  assert.equal(req("/api/export").kind, "admin");
});

test("trailing slashes do not bypass the map", () => {
  assert.equal(req("/banking/").kind, "area");
  assert.equal(req("/access/").kind, "admin");
});

test("the dashboard and the denied page never redirect into themselves", () => {
  assert.equal(req("/").kind, "any");
  assert.equal(req("/no-access").kind, "any");
});
