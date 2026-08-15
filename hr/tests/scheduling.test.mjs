// Interview time conversion. This decides what instant a candidate is actually
// invited to, so an off-by-one-timezone bug here sends a real person to the
// wrong hour — worth more test weight than most of the app.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIST,
  formatIST,
  instantToIstParts,
  istToInstant,
  scheduleWarnings,
  todayIST,
} from "./.build/scheduling.mjs";

test("3 PM IST is 09:30 UTC", () => {
  assert.equal(istToInstant("2026-07-28", "15:00"), "2026-07-28T09:30:00.000Z");
});

test("times before 05:30 IST roll back to the previous UTC day", () => {
  // The classic off-by-one: 5 AM IST on the 28th is 23:30 UTC on the 27th.
  assert.equal(istToInstant("2026-07-28", "05:00"), "2026-07-27T23:30:00.000Z");
});

test("midnight IST is the previous UTC evening", () => {
  assert.equal(istToInstant("2026-07-28", "00:00"), "2026-07-27T18:30:00.000Z");
});

test("conversion round-trips", () => {
  for (const [date, time] of [
    ["2026-07-28", "15:00"],
    ["2026-01-01", "00:00"],
    ["2026-12-31", "23:59"],
    ["2026-03-01", "05:29"],
  ]) {
    const instant = istToInstant(date, time);
    assert.deepEqual(instantToIstParts(instant), { date, time }, `${date} ${time}`);
  }
});

test("rejects malformed input rather than guessing", () => {
  for (const [d, t] of [["28-07-2026", "15:00"], ["2026-07-28", "3pm"], ["2026-07-28", "25:00"], ["", ""], ["2026-07-28", "15:99"]]) {
    assert.equal(istToInstant(d, t), null, `${d} ${t}`);
  }
});

test("displays in IST, not the server's zone", () => {
  assert.equal(formatIST("2026-07-28T09:30:00.000Z"), "Tue 28 Jul 2026, 3:00 PM IST");
  // 23:30 UTC is already the next morning in India.
  assert.equal(formatIST("2026-07-27T23:30:00.000Z"), "Tue 28 Jul 2026, 5:00 AM IST");
});

test("todayIST uses the Indian date, not the server's", () => {
  // 20:00 UTC on the 27th is already the 28th in India.
  assert.equal(todayIST(new Date("2026-07-27T20:00:00.000Z")), "2026-07-28");
  assert.equal(todayIST(new Date("2026-07-27T10:00:00.000Z")), "2026-07-27");
});

test("addDaysIST crosses months and years", () => {
  assert.equal(addDaysIST("2026-07-28", 1), "2026-07-29");
  assert.equal(addDaysIST("2026-07-31", 1), "2026-08-01");
  assert.equal(addDaysIST("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysIST("2026-03-01", -1), "2026-02-28");
});

// --- Warnings ---------------------------------------------------------------

const NOW = new Date("2026-07-27T06:00:00.000Z"); // 11:30 AM IST, Monday

test("flags a time in the past", () => {
  const w = scheduleWarnings("2026-07-26T09:30:00.000Z", NOW);
  assert.ok(w.some((x) => x.includes("past")));
});

test("flags a slot less than an hour away", () => {
  const w = scheduleWarnings("2026-07-27T06:30:00.000Z", NOW);
  assert.ok(w.some((x) => x.includes("less than an hour")));
});

test("flags out-of-hours and Sundays", () => {
  const night = scheduleWarnings(istToInstant("2026-07-28", "22:00"), NOW);
  assert.ok(night.some((x) => x.includes("working hours")));
  const sunday = scheduleWarnings(istToInstant("2026-08-02", "15:00"), NOW); // 2 Aug 2026 is a Sunday
  assert.ok(sunday.some((x) => x.includes("Sunday")));
});

test("a normal weekday afternoon produces no warnings", () => {
  assert.deepEqual(scheduleWarnings(istToInstant("2026-07-28", "15:00"), NOW), []);
});

test("9 AM and 8 PM IST are the accepted boundaries", () => {
  assert.deepEqual(scheduleWarnings(istToInstant("2026-07-28", "09:00"), NOW), [], "9 AM is fine");
  assert.ok(scheduleWarnings(istToInstant("2026-07-28", "20:00"), NOW).some((x) => x.includes("working hours")), "8 PM is out");
});
