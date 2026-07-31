// Tax obligation calendar for ShieldSync Security Pvt Ltd.
// Indian financial year: April (year N) – March (year N+1).
// All due dates follow the Income Tax Act / GST Act as of FY 2026–27.
// Pure module — no DB, no network — so the page, route handler and future
// reminder cron can all import it without pulling in server-only code.

// ── Financial year helpers ───────────────────────────────────────────────────

/** The FY that contains today.
 *  April onwards → this calendar year is the start.
 *  Jan–March → last calendar year is the start. */
export function currentFY(): { start: number; end: number; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1; // 1-based
  const start = m >= 4 ? y : y - 1;
  return { start, end: start + 1, label: `FY ${start}–${String(start + 1).slice(2)}` };
}

/** All 12 YYYY-MM keys in a financial year, April → March. */
export function fyMonths(fyStart: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${fyStart}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m++) months.push(`${fyStart + 1}-${String(m).padStart(2, "0")}`);
  return months;
}

// ── TDS on salary (Section 192) ──────────────────────────────────────────────

/** TDS challan due date for a given salary month.
 *  General rule: 7th of the following month.
 *  March exception: due 30 April (the Income Tax Act gives extra time for the year-end). */
export function tdsDueDate(salaryMonth: string): string {
  const [y, m] = salaryMonth.split("-").map(Number);
  if (m === 3) return `${y}-04-30`; // 30 April
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, "0")}-07`;
}

// ── Advance tax (Section 207) ────────────────────────────────────────────────

/** The four advance-tax instalment due dates and cumulative % targets
 *  (companies pay 100% by March 15 in four tranches). */
export function advanceTaxSchedule(fyStart: number): Array<{
  quarter: string;
  period: string;
  dueDate: string;
  cumPct: number;
}> {
  return [
    { quarter: "Q1", period: `Apr–Jun ${fyStart}`,    dueDate: `${fyStart}-06-15`,     cumPct: 15 },
    { quarter: "Q2", period: `Apr–Sep ${fyStart}`,    dueDate: `${fyStart}-09-15`,     cumPct: 45 },
    { quarter: "Q3", period: `Apr–Dec ${fyStart}`,    dueDate: `${fyStart}-12-15`,     cumPct: 75 },
    { quarter: "Q4", period: `Full year ${fyStart}`,  dueDate: `${fyStart + 1}-03-15`, cumPct: 100 },
  ];
}

// ── GST ──────────────────────────────────────────────────────────────────────

/** GSTR-3B (monthly summary return) and GSTR-1 (outward supplies) due dates
 *  for a given month. Turnover < 5 Cr → 20th for 3B, 11th for GSTR-1.
 *  Pass registered=false to suppress (pre-registration). */
export function gstDueDates(month: string): { gstr3b: string; gstr1: string } {
  const [y, m] = month.split("-").map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    gstr3b: `${ny}-${pad(nm)}-20`,
    gstr1:  `${ny}-${pad(nm)}-11`,
  };
}

// ── Status ───────────────────────────────────────────────────────────────────

export type ObligationStatus = "paid" | "overdue" | "due-soon" | "upcoming" | "future";

/** Classify an obligation relative to today. `daysUntilDueSoon` defaults to 10. */
export function obligationStatus(dueDate: string, paid: boolean, daysUntilDueSoon = 10): ObligationStatus {
  if (paid) return "paid";
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
  if (days < 0)              return "overdue";
  if (days <= daysUntilDueSoon) return "due-soon";
  if (days <= 60)            return "upcoming";
  return "future";
}

export const STATUS_STYLE: Record<ObligationStatus, { bg: string; fg: string; label: string }> = {
  paid:      { bg: "#e7f6ee", fg: "#1a7a45", label: "✓ Paid" },
  overdue:   { bg: "#fdecef", fg: "#9a2233", label: "⚠ Overdue" },
  "due-soon":{ bg: "#fdf4e3", fg: "#8a5a00", label: "Due soon" },
  upcoming:  { bg: "#eef2f8", fg: "#41506a", label: "Upcoming" },
  future:    { bg: "#f4f7fb", fg: "#8a94a3", label: "Future" },
};

// ── Formatting ────────────────────────────────────────────────────────────────

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export function dueDateLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
