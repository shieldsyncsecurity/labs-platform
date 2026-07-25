// Which permission each URL needs. Pure and edge-safe so the middleware — the
// single choke point every page and API call passes through — can enforce it
// without importing server-only code.
//
// WHY A CENTRAL MAP rather than a guard call inside each of the ~55 pages and
// route handlers: a guard you must remember to add is a guard that eventually
// gets forgotten, and the failure mode is silent (the page just works, for
// everyone). Here, anything NOT listed is administrator-only, so forgetting to
// map a new page fails closed and loudly instead of leaking it.

import type { Area } from "./access";

export type Requirement =
  | { kind: "public" } // no session at all (login, questionnaire, auth callbacks)
  | { kind: "any" } // any signed-in user, no specific permission
  | { kind: "admin" } // administrator only
  /** `alsoSeeSalary` closes the obvious hole in field-level masking: a page
   * whose whole purpose is entering or changing pay cannot be protected by
   * blanking the figures on it. Those pages require the salary permission on
   * top of the area permission. */
  | { kind: "area"; area: Area; need: "read" | "write"; alsoSeeSalary?: true };

const PUBLIC: Requirement = { kind: "public" };
const ANY: Requirement = { kind: "any" };
const ADMIN: Requirement = { kind: "admin" };
const area = (a: Area, need: "read" | "write"): Requirement => ({ kind: "area", area: a, need });

/** Write verbs need `write`; GET/HEAD need `read`. */
function byMethod(a: Area, method: string): Requirement {
  return area(a, method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write");
}

/**
 * Resolve a request to the permission it requires.
 * `pathname` must be the URL path; `method` the HTTP verb.
 */
export function requirementFor(pathname: string, method: string): Requirement {
  const p = pathname.replace(/\/+$/, "") || "/";

  // --- Public surface (mirrors middleware's own allowlist) ---
  if (p === "/login" || p.startsWith("/api/auth/") || p.startsWith("/q/") || p.startsWith("/api/q/")) return PUBLIC;

  // --- Signed in, nothing more ---
  // The dashboard filters its own cards; /no-access must never redirect to
  // itself; /preview/* is fictional sample data used to review templates.
  if (p === "/" || p === "/no-access" || p.startsWith("/preview/") || p.startsWith("/sealed/")) return ANY;

  // --- Administrator only ---
  if (p === "/access" || p.startsWith("/api/access")) return ADMIN;

  // --- Banking ---
  if (p === "/banking" || p.startsWith("/banking/")) return area("banking", "read");
  if (p.startsWith("/api/banking")) {
    // Parsing an uploaded statement for review is part of importing it.
    if (p === "/api/banking/parse") return area("banking", "write");
    return byMethod("banking", method);
  }

  // --- Audit ---
  if (p === "/audit" || p.startsWith("/audit/") || p.startsWith("/api/audit")) return area("audit", "read");

  // --- Payroll ---
  if (p === "/payslips" || p.startsWith("/payslips/")) return area("payroll", "read");

  // --- Recruiting ---
  if (p.startsWith("/manage-candidates")) {
    const isEdit = p.endsWith("/new") || p.endsWith("/edit") || p.endsWith("/hire") || p.endsWith("/questions");
    return area("candidates", isEdit ? "write" : "read");
  }
  if (p.startsWith("/api/candidates")) {
    // Sending a questionnaire, hiring and resume parsing are all changes.
    if (p.endsWith("/send") || p.endsWith("/hire") || p.endsWith("/parse-resume")) return area("candidates", "write");
    return byMethod("candidates", method);
  }

  // --- Employees, and everything hanging off an employee record ---
  if (p.startsWith("/api/employees")) {
    if (/\/docs(\/|$)/.test(p)) return byMethod("kyc", method); // the ID vault
    if (/\/generated(\/|$)/.test(p) || /\/issued(\/|$)/.test(p) || /\/email$/.test(p)) return byMethod("documents", method);
    return byMethod("employees", method);
  }
  // Creating or revising an employee means setting their pay, so these need the
  // salary permission as well — masking a figure on a form you can type into is
  // no protection at all.
  if (p === "/employees") return area("employees", "read");
  if (p === "/employees/new") return { kind: "area", area: "employees", need: "write", alsoSeeSalary: true };
  if (p.startsWith("/employees/")) {
    // Letter builders write a document; the payslip builder runs payroll.
    if (/\/payslip$/.test(p)) return { kind: "area", area: "payroll", need: "write", alsoSeeSalary: true };
    if (/\/(offer|internship-offer|leave|verification|confirmation|experience|completion)$/.test(p)) return area("documents", "write");
    if (/\/issued\//.test(p)) return area("documents", "read");
    if (/\/(edit|revise|convert)$/.test(p)) return { kind: "area", area: "employees", need: "write", alsoSeeSalary: true };
    return area("employees", "read"); // /employees/:seq
  }

  // --- Bulk data export: the whole employee master in one file ---
  if (p === "/api/export") return area("employees", "read");

  // Unmapped: administrator only. New surfaces must be added above deliberately.
  return ADMIN;
}
