import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { visibleEmployees } from "@/lib/server/employee-view";
import { can } from "@/lib/access";
import { formatINR } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payslips — ShieldSync HR", robots: { index: false, follow: false } };

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };
const btn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : lastMonth();
  // Default = active only (this is the run-current-payroll surface). Opt in with
  // ?includeExited=1 to also list leavers, so a leaver's already-issued slips
  // don't vanish from the payroll list for the month they were paid.
  const includeExited = sp.includeExited === "1";

  const viewer = await getViewer();
  const { isAdmin, access } = viewer;

  let employees: Employee[] = [];
  let error: string | null = null;
  try {
    const all = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
    // Administrator-only records are not payroll rows for anyone else — this
    // page lists name, designation and gross for every active employee, so the
    // per-seq middleware gate (which sees no seq in this URL) can't cover it.
    employees = await visibleEmployees(all, viewer);
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }
  // The one list the issued-slip lookup AND the table both iterate — so a row
  // that shows always has its "Issued" marker resolved.
  const rows = includeExited ? employees : employees.filter((e) => e.status !== "exited");

  // Gate the row actions to what the viewer can actually do, so a link never
  // leads to a 403. (Admin always passes.)
  const canGenerate = isAdmin || can(access, "payroll", "write");
  const canOpenIssued = isAdmin || can(access, "documents", "read");

  // Month status: an issued payslip carries ref "<employeeId> <YYYY-MM>". Keep
  // the docId so "Issued" links to the ARCHIVED slip, not a fresh regeneration
  // that could differ after a revision/LOP change.
  const issued = new Map<number, string>();
  await Promise.all(
    rows.map(async (e) => {
      try {
        const gens = (await hrFetch<{ generated: Array<{ docId: string; docType: string; ref: string }> }>(`/hr/employees/${e.seq}/generated`)).generated ?? [];
        const hit = gens.find((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`)); // newest-first
        if (hit) issued.set(e.seq, hit.docId);
      } catch {
        /* marker is best-effort */
      }
    }),
  );

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Dashboard</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Payslips</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>Pick a month, then generate each employee’s slip. Deductions (PF / ESI / PT / TDS / LOP) are set on the generate screen.</p>

      <form method="get" style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 }}>Pay month</label>
          <input type="month" name="month" defaultValue={month} style={input} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#41506a", paddingBottom: 7 }}>
          <input type="checkbox" name="includeExited" value="1" defaultChecked={includeExited} /> Include exited
        </label>
        <button type="submit" style={btn}>Show</button>
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <div style={{ fontSize: 12.5, color: "#8a94a3" }}>{includeExited ? "All employees (incl. exited)" : "Active employees"} — {monthLabel(month)}</div>
        <Link href="/payslips/summary" style={{ fontSize: 12.5, color: "#2f4fb0", fontWeight: 600 }}>FY salary + TDS summary &rarr;</Link>
      </div>

      {error ? (
        <div style={{ marginTop: 12, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{error}</div>
      ) : rows.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "#8a94a3" }}>{includeExited ? "No employees on record." : "No active employees."} <Link href="/employees/new" style={{ color: "#2f4fb0" }}>Add one</Link>.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
              <th style={{ padding: "8px 10px" }}>Employee ID</th>
              <th style={{ padding: "8px 10px" }}>Name</th>
              <th style={{ padding: "8px 10px" }}>Designation</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Gross / mo</th>
              <th style={{ padding: "8px 10px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.seq} style={{ borderTop: "1px solid #e6ebf3" }}>
                <td style={{ padding: "10px", fontFamily: "monospace", color: "#1f3a5f" }}>{e.employeeId}</td>
                <td style={{ padding: "10px", fontWeight: 600 }}>
                  {e.name}
                  {e.status === "exited" ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: "#8a6320", background: "#fdf4e3", borderRadius: 999, padding: "1px 7px" }}>exited</span> : null}
                </td>
                <td style={{ padding: "10px", color: "#5b6676" }}>{e.designation}</td>
                <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatINR(e.grossMonthly)}</td>
                <td style={{ padding: "10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {issued.get(e.seq) ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      {/* Status pill (not a link) — distinct from the actions beside it. */}
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#1a7a45", background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 999, padding: "3px 10px" }}>
                        ✓ Issued
                      </span>
                      {canOpenIssued ? (
                        <Link href={`/employees/${e.seq}/issued/${issued.get(e.seq)}`} style={{ color: "#2f4fb0", fontWeight: 700, fontSize: 12.5 }}>
                          Open &rarr;
                        </Link>
                      ) : null}
                      {/* Amber, not a plain link — regenerating creates ANOTHER issued
                          slip for the month (same caution color as the duplicate-payslip
                          warning on the generate screen), so it reads as deliberate. */}
                      {canGenerate ? (
                        <Link
                          href={`/employees/${e.seq}/payslip?month=${month}`}
                          style={{ fontSize: 11, fontWeight: 700, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 999, padding: "3px 10px" }}
                        >
                          Regenerate
                        </Link>
                      ) : null}
                    </span>
                  ) : canGenerate ? (
                    <Link href={`/employees/${e.seq}/payslip?month=${month}`} style={{ color: "#2f4fb0", fontWeight: 700 }}>Generate &rarr;</Link>
                  ) : (
                    <span style={{ color: "#c3cee0" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </main>
  );
}
