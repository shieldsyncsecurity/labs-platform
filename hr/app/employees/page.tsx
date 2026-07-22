import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employees — ShieldSync HR", robots: { index: false, follow: false } };

const fmtINR = (n: number) => "INR " + (Number(n) || 0).toLocaleString("en-IN");

export default async function EmployeesPage() {
  let employees: Employee[] = [];
  let error: string | null = null;
  try {
    const data = await hrFetch<{ employees?: Employee[] }>("/hr/employees");
    employees = data.employees ?? [];
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Dashboard</Link>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Employees</h1>
        </div>
        <Link
          href="/employees/new"
          style={{ background: "#1f3a5f", color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "9px 14px" }}
        >
          + Add employee
        </Link>
      </div>

      {error ? (
        <div style={{ marginTop: 20, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>
          {error}
        </div>
      ) : employees.length === 0 ? (
        <div style={{ marginTop: 20, color: "#5b6676", fontSize: 13 }}>No employees yet. Add your first one to generate their letter and payslips.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
              <th style={{ padding: "8px 10px" }}>Employee ID</th>
              <th style={{ padding: "8px 10px" }}>Name</th>
              <th style={{ padding: "8px 10px" }}>Designation</th>
              <th style={{ padding: "8px 10px" }}>Status</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>Gross / mo</th>
              <th style={{ padding: "8px 10px" }}></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.seq} style={{ borderTop: "1px solid #e6ebf3" }}>
                <td style={{ padding: "10px", fontFamily: "monospace", color: "#1f3a5f" }}>{e.employeeId}</td>
                <td style={{ padding: "10px", fontWeight: 600 }}>{e.name}</td>
                <td style={{ padding: "10px", color: "#5b6676" }}>{e.designation}</td>
                <td style={{ padding: "10px" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: "2px 9px", background: e.status === "exited" ? "#fdecef" : "#e7f6ee", color: e.status === "exited" ? "#9a2233" : "#1a7a45" }}>
                    {e.status === "exited" ? "Exited" : "Active"}
                  </span>
                </td>
                <td style={{ padding: "10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtINR(e.grossMonthly)}</td>
                <td style={{ padding: "10px", textAlign: "right" }}>
                  <Link href={`/employees/${e.seq}`} style={{ color: "#2f4fb0", fontWeight: 600 }}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
