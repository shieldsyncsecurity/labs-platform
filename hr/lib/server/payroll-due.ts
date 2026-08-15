import { hrFetch } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";

/**
 * "Is anyone's salary still unpaid?" — one shared answer for the dashboard
 * reminder banner and the daily email, so the two can never disagree.
 *
 * Salary for a month is treated as DUE once that month has ended: an active
 * employee with no issued payslip carrying ref "<employeeId> <YYYY-MM>". That's
 * the same signal the /payslips table marks "Issued" with, so the banner and
 * the table are always telling the same story.
 */

export type PayrollDue = {
  /** The month payroll is owed for, "YYYY-MM" (the month that just ended). */
  month: string;
  monthLabel: string;
  /** Active employees with no payslip issued for `month`. */
  due: { seq: number; name: string; employeeId?: string }[];
  /** Active headcount considered. */
  total: number;
  /** Days since the month closed — drives how loud the reminder is. */
  daysSinceMonthEnd: number;
  /** Past the grace period (salary is normally paid in the first week). */
  overdue: boolean;
};

export function payrollMonth(now = new Date()): string {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

/** Salary is normally run in the first few days of the new month; after this we
 *  call it overdue rather than merely due. */
const GRACE_DAYS = 7;

/**
 * The month an employee's pay STARTS being owed, from their joining date
 * ("02 March 2026" -> "2026-03"). Without this, anyone hired part-way through
 * the year is reported as unpaid for every month before they existed: hire
 * someone on 1 August and the 1 September reminder demands a July payslip for
 * them. A reminder that is wrong on day one is a reminder that gets ignored.
 *
 * Returns null when the date can't be parsed, and callers then fall back to
 * flagging — an unreadable joining date should not silently excuse payroll.
 */
function joinedMonth(e: Employee): string | null {
  const t = Date.parse(e.dateOfJoining);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * People deliberately outside the payslip run (e.g. a director paid another way).
 * Comma-separated names or employee IDs in HR_REMINDER_EXCLUDE, matched
 * case/space-insensitively. MUST stay in sync with the same variable on the HR
 * Lambda (engine/hr-handler.mjs) — the banner and the email share one rule.
 */
const EXCLUDED = new Set(
  (process.env.HR_REMINDER_EXCLUDE ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean),
);
function isExcluded(e: Employee): boolean {
  const n = (e.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const id = (e.employeeId ?? "").trim().toLowerCase();
  return EXCLUDED.has(n) || (id.length > 0 && EXCLUDED.has(id));
}

/**
 * @param hiddenSeqs Employees this viewer may not see at all (administrator-only
 *   records). Passed IN rather than resolved here so this module stays free of
 *   request context and unit-testable — the caller already knows its viewer.
 *   The banner NAMES who is owed, so a hidden record must not reach it.
 */
export async function getPayrollDue(now = new Date(), hiddenSeqs?: Set<number>): Promise<PayrollDue> {
  const month = payrollMonth(now);
  const all = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
  const employees = hiddenSeqs?.size ? all.filter((e) => !hiddenSeqs.has(e.seq)) : all;
  const active = employees.filter((e) => {
    if (e.status === "exited") return false;
    if (isExcluded(e)) return false;
    const joined = joinedMonth(e);
    // "2026-07" < "2026-08" compares correctly as a string: fixed width, zero-padded.
    return joined === null || joined <= month;
  });

  const due: PayrollDue["due"] = [];
  await Promise.all(
    active.map(async (e) => {
      try {
        const gens =
          (await hrFetch<{ generated: Array<{ docType: string; ref: string }> }>(`/hr/employees/${e.seq}/generated`))
            .generated ?? [];
        const issued = gens.some((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`));
        if (!issued) due.push({ seq: e.seq, name: e.name, employeeId: e.employeeId });
      } catch {
        // Engine hiccup on ONE employee must not silently under-report payroll —
        // treat them as still owed, since that fails toward reminding.
        due.push({ seq: e.seq, name: e.name, employeeId: e.employeeId });
      }
    }),
  );
  due.sort((a, b) => a.seq - b.seq);

  // Day 1 of the new month = 1 day since the pay month closed.
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysSinceMonthEnd = Math.max(
    0,
    Math.floor((now.getTime() - startOfThisMonth.getTime()) / 86_400_000) + 1,
  );

  return {
    month,
    monthLabel: monthLabel(month),
    due,
    total: active.length,
    daysSinceMonthEnd,
    overdue: daysSinceMonthEnd > GRACE_DAYS,
  };
}
