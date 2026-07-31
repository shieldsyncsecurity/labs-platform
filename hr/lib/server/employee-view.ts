// ONE definition of "which employees may this viewer see, and which fields of
// them" — applied server-side, before data leaves the process.
//
// WHY THIS EXISTS: masking used to live in JSX (`showSalary ? fmtINR(x) : MASKED`)
// while the APIs behind those pages returned whole DynamoDB items. A staff member
// with employees:read and seeSalary=false therefore saw "INR ••••" in the table
// and every salary, PAN and bank account by opening /api/employees in the next
// tab. Field masking that a fetch can step around is decoration, not a control.
//
// Same story for administrator-only records: the middleware 404s
// /employees/:seq, but a URL-shape regex cannot cover collection routes that
// carry no seq (/api/employees, payroll listings, the dashboard's due banner),
// and those returned the hidden record in full.
//
// So both rules live here, and every reader of employee data goes through them.

// NEVER import this from client code — it reads the engine secret via hrFetch.
import { hrFetch } from "./hr-engine";
import type { Viewer } from "./hr-access";
import type { Employee } from "@/lib/employee";

/** Pay figures — hidden unless the viewer holds seeSalary. */
const SALARY_FIELDS = ["grossMonthly", "annualCTC", "structure", "revisions", "variableMin", "variableMax"] as const;
/** Details that enable a payment or prove identity — gated on seeBankDetails. */
const BANK_FIELDS = ["bankAccount", "bankName", "bankBranch", "ifsc", "pan", "aadhaarLast4", "uanPf"] as const;
/** The self-serve PIN credential. NEVER leaves the engine, for anyone —
 * it is a login secret, not a record field, and no UI has any use for it. */
const SECRET_FIELDS = ["selfPinHash", "selfPinSalt", "selfFailedAttempts", "selfLockedUntil"] as const;

/**
 * Strip fields this viewer may not see. Returns a copy — the caller's object is
 * untouched. Admins keep everything except the PIN secrets.
 */
export function projectEmployee<T extends Partial<Employee>>(emp: T, viewer: Viewer): Partial<T> {
  const out: Record<string, unknown> = { ...emp };
  for (const f of SECRET_FIELDS) delete out[f];
  if (!(viewer.isAdmin || viewer.access.seeSalary)) for (const f of SALARY_FIELDS) delete out[f];
  if (!(viewer.isAdmin || viewer.access.seeBankDetails)) for (const f of BANK_FIELDS) delete out[f];
  return out as Partial<T>;
}

/**
 * The seqs hidden from non-admin viewers. Fails CLOSED: if the restriction list
 * can't be read we cannot tell which records are protected, so callers treat
 * EVERY record as hidden rather than risk exposing the protected one.
 */
export async function restrictedSeqs(viewer: Viewer): Promise<{ seqs: Set<number>; hideAll: boolean }> {
  if (viewer.isAdmin) return { seqs: new Set(), hideAll: false };
  try {
    const { restrictedSeqs: list } = await hrFetch<{ restrictedSeqs?: number[] }>("/hr/access");
    return { seqs: new Set(list ?? []), hideAll: false };
  } catch {
    return { seqs: new Set(), hideAll: true };
  }
}

/**
 * Drop administrator-only records, WITHOUT touching fields. For pages that
 * legitimately display pay (payroll listings, the FY summary) — those require
 * the salary permission to open at all, so masking their figures would only
 * produce blanks or, worse, zeroes that read as "unpaid".
 */
export async function visibleEmployees<T extends { seq: number }>(employees: T[], viewer: Viewer): Promise<T[]> {
  const { seqs, hideAll } = await restrictedSeqs(viewer);
  if (hideAll) return [];
  return employees.filter((e) => !seqs.has(e.seq));
}

/**
 * Both rules: drop administrator-only records AND strip fields the viewer may
 * not see. For generic data endpoints (/api/employees) whose caller could be
 * anything, where a raw record would defeat the field permissions entirely.
 */
export async function visibleProjectedEmployees<T extends Partial<Employee> & { seq: number }>(
  employees: T[],
  viewer: Viewer,
): Promise<Array<Partial<T>>> {
  return (await visibleEmployees(employees, viewer)).map((e) => projectEmployee(e, viewer));
}
