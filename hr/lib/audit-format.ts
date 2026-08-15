// Shared audit-detail formatting. Lives here — not inside the audit page — so
// the CSV export enforces the SAME salary mask as the on-screen log. When the
// two had their own copies, the page masked pay figures while /api/audit/export
// wrote them out in full: a fetch stepping around a field mask, again.

import { MASKED } from "./access";

/** Detail keys that carry pay figures. The log records salary changes as
 * `grossFrom`/`grossTo`, so an audit:read holder without the salary permission
 * could read everyone's pay history from the one screen designed to show
 * everything. Values are replaced, not the whole row: WHO changed WHOSE pay
 * WHEN is exactly what an audit trail is for; the amount is not. */
export const SALARY_DETAIL_KEYS = new Set(["grossFrom", "grossTo", "gross", "ctcFrom", "ctcTo", "annualCTC", "netPay", "amount"]);

export function fmtDetail(detail: Record<string, unknown> | undefined, showSalary: boolean): string {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      if (!showSalary && SALARY_DETAIL_KEYS.has(k)) return `${k}: ${MASKED}`;
      return `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    })
    .join(" · ");
}
