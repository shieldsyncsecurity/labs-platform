// The payroll reminder's month arithmetic and joining-date rule. This decides
// what the dashboard banner and the daily email both claim, so a mistake here
// nags about the wrong month or about people who hadn't started yet — and a
// reminder that is wrong is a reminder that gets ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { payrollMonth, monthLabel } from "./.build/payroll-due.mjs";

test("payroll is owed for the month that just CLOSED, never the current one", () => {
  // Salary for July is paid in early August, so on any day in July nothing
  // about July is owed yet — the reminder must still be pointing at June.
  assert.equal(payrollMonth(new Date(2026, 6, 25)), "2026-06", "25 July -> June");
  assert.equal(payrollMonth(new Date(2026, 6, 1)), "2026-06", "1 July -> June");
  assert.equal(payrollMonth(new Date(2026, 6, 31)), "2026-06", "31 July -> June");
  assert.equal(payrollMonth(new Date(2026, 7, 1)), "2026-07", "1 August -> July");
  assert.equal(payrollMonth(new Date(2026, 7, 7)), "2026-07", "7 August (pay day) -> July");
});

test("rolls back across a year boundary", () => {
  assert.equal(payrollMonth(new Date(2026, 0, 3)), "2025-12", "3 Jan -> Dec of last year");
});

test("handles month-end dates without slipping a month", () => {
  // Naive setMonth(-1) on the 31st lands in the wrong month for short months;
  // payrollMonth pins to the 1st first, so this must hold.
  assert.equal(payrollMonth(new Date(2026, 2, 31)), "2026-02", "31 March -> February");
  assert.equal(payrollMonth(new Date(2026, 4, 31)), "2026-04", "31 May -> April");
});

test("month labels read the way a person would say them", () => {
  assert.equal(monthLabel("2026-07"), "July 2026");
  assert.equal(monthLabel("2025-12"), "December 2025");
});

test("zero-padded months compare correctly as strings", () => {
  // The joining-date rule relies on plain string comparison, which is only safe
  // because every month is fixed-width and zero-padded.
  assert.ok("2026-07" < "2026-08");
  assert.ok("2026-09" < "2026-10", "the 9 -> 10 boundary is where unpadded values break");
  assert.ok("2025-12" < "2026-01");
});
