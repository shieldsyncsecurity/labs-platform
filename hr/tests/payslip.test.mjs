// Unit tests for the pure payroll math — the highest-risk, easiest-to-test code
// in the portal. Run via `npm test` (tests/run.mjs bundles the TS lib first).
import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestStructure,
  prorateStructure,
  computeDeductions,
  amountInWords,
  rupeesToWords,
  buildPayslip,
} from "./.build/payslip.mjs";

// --- suggestStructure: the signed Annexure A convention ----------------------
test("suggestStructure reproduces Diya's signed Annexure (gross 30,000)", () => {
  const s = suggestStructure(30000);
  assert.deepEqual(s, { basic: 15000, hra: 6000, conveyance: 1600, special: 7400, gross: 30000 });
});

test("suggestStructure always reconciles to gross", () => {
  for (const g of [1, 999, 3210, 21000, 45000, 123457]) {
    const s = suggestStructure(g);
    assert.equal(s.basic + s.hra + s.conveyance + s.special, s.gross, `gross ${g}`);
    assert.equal(s.gross, g);
    assert.ok(s.special >= 0, `special never negative (gross ${g})`);
  }
});

// --- prorateStructure: LOP must reduce pay and reconcile ---------------------
test("LOP 0 returns the structure unchanged (Diya March: full pay)", () => {
  const s = suggestStructure(30000);
  assert.equal(prorateStructure(s, 0, 31), s);
});

test("LOP 5 of 31 prorates and reconciles exactly", () => {
  const s = suggestStructure(45000);
  const p = prorateStructure(s, 5, 31);
  assert.equal(p.gross, Math.round((45000 * 26) / 31)); // 37,742
  assert.equal(p.basic + p.hra + p.conveyance + p.special, p.gross);
  assert.ok(p.gross < s.gross);
});

test("LOP equal to the whole month zeroes pay", () => {
  const p = prorateStructure(suggestStructure(30000), 31, 31);
  assert.equal(p.gross, 0);
  assert.equal(p.basic + p.hra + p.conveyance + p.special, 0);
});

// --- computeDeductions: statutory boundaries ---------------------------------
test("PF = 12% of basic; cap applies only when enabled", () => {
  const s = { basic: 22500, hra: 9000, conveyance: 1600, special: 11900, gross: 45000 };
  assert.equal(computeDeductions(s, { pf: { enabled: true } }).pf, 2700);
  assert.equal(computeDeductions(s, { pf: { enabled: true, capAtWageCeiling: true } }).pf, 1800); // 12% of 15,000
});

test("PF cap boundary: basic exactly 15,000 caps to itself", () => {
  const s = { basic: 15000, hra: 6000, conveyance: 1600, special: 7400, gross: 30000 };
  assert.equal(computeDeductions(s, { pf: { enabled: true, capAtWageCeiling: true } }).pf, 1800);
});

test("ESI applies at gross 21,000 and NOT at 21,001", () => {
  const at = { basic: 10500, hra: 4200, conveyance: 1600, special: 4700, gross: 21000 };
  const over = { ...at, special: 4701, gross: 21001 };
  assert.equal(computeDeductions(at, { esi: { enabled: true } }).esi, Math.round(21000 * 0.0075 * 100) / 100);
  assert.equal(computeDeductions(over, { esi: { enabled: true } }).esi, 0);
});

test("disabled/negative entered amounts clamp to zero", () => {
  const s = suggestStructure(30000);
  const d = computeDeductions(s, { pt: { enabled: true, amount: -50 }, tds: { enabled: false, amount: 999 } });
  assert.equal(d.pt, 0);
  assert.equal(d.tds, 0);
  assert.equal(d.total, 0);
});

// --- amount in words: Indian grouping ----------------------------------------
test("amountInWords matches the signed payslip style", () => {
  assert.equal(amountInWords(30000), "Indian Rupees Thirty Thousand Only");
  assert.equal(amountInWords(42300), "Indian Rupees Forty Two Thousand Three Hundred Only");
});

test("Indian grouping: lakh + crore", () => {
  assert.equal(rupeesToWords(360000), "Three Lakh Sixty Thousand");
  assert.equal(rupeesToWords(12345678), "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
});

test("paise render when fractional", () => {
  assert.equal(amountInWords(100.5), "Indian Rupees One Hundred and Fifty Paise Only");
});

test("zero", () => {
  assert.equal(amountInWords(0), "Indian Rupees Zero Only");
});

// --- buildPayslip: end-to-end math -------------------------------------------
test("buildPayslip: gross - deductions = net, words match", () => {
  const p = buildPayslip({
    employee: { name: "T", employeeId: "SSS/EMP/0001", designation: "X", department: "Y", dateOfJoining: "1 Jan 2026" },
    period: { monthLabel: "May 2026", periodLabel: "01 - 31 May 2026", standardDays: 31, daysPaid: 31, lopDays: 0, payDate: "05 June 2026" },
    earnings: suggestStructure(45000),
    deductionConfig: { pf: { enabled: true } },
  });
  assert.equal(p.deductions.pf, 2700);
  assert.equal(p.netPay, 42300);
  assert.equal(p.netPayWords, "Indian Rupees Forty Two Thousand Three Hundred Only");
  assert.equal(p.ptNote, true); // UP levies no PT and PT toggle is off
});
