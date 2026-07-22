import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
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

  let employees: Employee[] = [];
  let error: string | null = null;
  try {
    employees = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }
  const active = employees.filter((e) => e.status !== "exited");

  // Month status: an issued payslip carries ref "<employeeId> <YYYY-MM>", so a
  // per-employee history check shows who already got this month's slip.
  const issued = new Map<number, boolean>();
  await Promise.all(
    active.map(async (e) => {
      try {
        const gens = (await hrFetch<{ generated: Array<{ docType: string; ref: string }> }>(`/hr/employees/${e.seq}/generated`)).generated ?? [];
        issued.set(e.seq, gens.some((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`)));
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
        <button type="submit" style={btn}>Show</button>
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 14 }}>
        <div style={{ fontSize: 12.5, color: "#8a94a3" }}>Active employees — {monthLabel(month)}</div>
        <Link href="/payslips/summary" style={{ fontSize: 12.5, color: "#2f4fb0", fontWeight: 600 }}>FY salary + TDS summary &rarr;</Link>
      </div>

      {error ? (
        <div style={{ marginTop: 12, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{error}</div>
      ) : active.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "#8a94a3" }}>No active employees. <Link href="/employees/new" style={{ color: "#2f4fb0" }}>Add one</Link>.</p>
      ) : (
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
            {active.map((e) => (
              <tr key={e.seq} style={{ borderTop: "1px solid #e6ebf3" }}>
                <td style={{ padding: "10px", fontFamily: "monospace", color: "#1f3a5f" }}>{e.employeeId}</td>
                <td style={{ padding: "10px", fontWeight: 600 }}>{e.name}</td>
                <td style={{ padding: "10px", color: "#5b6676" }}>{e.designation}</td>
                <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatINR(e.grossMonthly)}</td>
                <td style={{ padding: "10px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {issued.get(e.seq) ? (
                    <span style={{ color: "#1a7a45", fontWeight: 700, fontSize: 12, marginRight: 10 }}>✓ Issued</span>
                  ) : null}
                  <Link href={`/employees/${e.seq}/payslip?month=${month}`} style={{ color: "#2f4fb0", fontWeight: 600 }}>
                    {issued.get(e.seq) ? "Re-open / regenerate →" : "Generate →"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
