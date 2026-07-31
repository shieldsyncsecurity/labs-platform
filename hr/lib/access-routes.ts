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
  // /my/* and /api/self/* are ALSO exempted directly in middleware.ts (before
  // this map is even consulted) since they're ss_self-authenticated, not
  // ss_hr-authenticated — listed here too only so this file stays an accurate
  // map of the whole public surface.
  if (
    p === "/login" ||
    p.startsWith("/api/auth/") ||
    p.startsWith("/q/") ||
    p.startsWith("/api/q/") ||
    p === "/my" ||
    p.startsWith("/my/") ||
    p.startsWith("/api/self/") ||
    // Offer-acceptance acknowledgment, reached from a link in the offer email.
    // Also exempted directly in middleware.ts; listed here so this file stays
    // an accurate map of the whole public surface.
    p.startsWith("/accept/") ||
    p.startsWith("/api/accept/") ||
    // Public invoice view — token-authenticated (signed JWT, audience "ss-inv").
    // A client with the share link can view their invoice without an HR session.
    p.startsWith("/inv/")
  ) {
    return PUBLIC;
  }

  // --- Signed in, nothing more ---
  // The dashboard filters its own cards; /no-access must never redirect to
  // itself; /preview/* is fictional sample data used to review templates.
  if (p === "/" || p === "/no-access" || p.startsWith("/preview/") || p.startsWith("/sealed/")) return ANY;

  // --- Administrator only ---
  if (p === "/access" || p.startsWith("/api/access")) return ADMIN;
  // Tax obligations calendar + TDS summary — financial data, admin only.
  if (p === "/tax") return ADMIN;
  // P&L / financials — derived from banking, admin only.
  if (p === "/financials" || p.startsWith("/financials/")) return ADMIN;
  // B2B invoices — billing data + share-link generation, admin only.
  if (p === "/invoices" || p.startsWith("/invoices/") || p.startsWith("/api/invoices")) return ADMIN;
  // Names the tenant and the granted Graph roles — owner-only diagnostics.
  if (p === "/api/graph-check") return ADMIN;

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
  // These pages exist to display pay: the run-payroll list shows every active
  // employee's gross, and the FY summary shows their full-year gross, TDS and
  // net alongside their PAN. There is nothing left of them once pay is masked,
  // so they require the salary permission outright rather than rendering blanks
  // (or, worse, zeroes that read as "unpaid").
  if (p === "/payslips" || p.startsWith("/payslips/")) {
    return { kind: "area", area: "payroll", need: "read", alsoSeeSalary: true };
  }

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
  // The scheduling assistant can only ever propose a candidate write, so it
  // needs that permission — the model must not become a way around the gate.
  if (p === "/api/assistant") return area("candidates", "write");

  // --- Employees, and everything hanging off an employee record ---
  if (p.startsWith("/api/employees")) {
    // Minting someone's self-serve PIN hands over a login credential that can
    // read their letters and payslips — strictly more than "edit an employee",
    // so it does NOT inherit the employees permission below.
    if (/\/self-pin$/.test(p)) return ADMIN;
    // Who may see a record at all is an owner decision, never a staff one.
    if (/\/visibility$/.test(p)) return ADMIN;
    if (/\/docs(\/|$)/.test(p)) return byMethod("kyc", method); // the ID vault
    if (/\/generated(\/|$)/.test(p) || /\/issued(\/|$)/.test(p) || /\/email$/.test(p)) return byMethod("documents", method);
    // Creating or editing the RECORD means writing pay — the request body
    // carries grossMonthly and the salary structure. The FORM was already gated
    // on the salary permission (/employees/new, /edit, /revise below); gating
    // only the form left the API it posts to open, i.e. the same hole one layer
    // down. Offboarding and deleting are excluded: they set neither.
    if ((method === "POST" || method === "PUT" || method === "PATCH") && !/\/status$/.test(p)) {
      return { kind: "area", area: "employees", need: "write", alsoSeeSalary: true };
    }
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
    if (/\/(offer|internship-offer|leave|verification|confirmation|experience|completion|employment-history|resignation-acceptance)$/.test(p)) return area("documents", "write");
    if (/\/issued\//.test(p)) return area("documents", "read");
    if (/\/(edit|revise|convert)$/.test(p)) return { kind: "area", area: "employees", need: "write", alsoSeeSalary: true };
    return area("employees", "read"); // /employees/:seq
  }

  // --- Bulk data export: administrator only ------------------------------
  // This returns the ENTIRE data plane in one JSON: every employee, every
  // issued-document snapshot (which contain salary figures), and KYC metadata.
  // Gating it on `employees: read` would have made every field-level protection
  // decorative — someone barred from seeing salary in the UI could download all
  // of it in one request. A whole-company backup is an owner action.
  if (p === "/api/export") return ADMIN;

  // Unmapped: administrator only. New surfaces must be added above deliberately.
  return ADMIN;
}
