import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { COMPANY } from "@/lib/company";
import { formatINR, type Payslip } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";
import { LETTERHEAD_CSS } from "@/components/letterhead-css";
import { Masthead } from "@/components/Masthead";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "FY salary summary — ShieldSync HR", robots: { index: false, follow: false } };

type GenRow = { docId: string; docType: string; ref: string };
type MonthRow = { month: string; gross: number; pf: number; esi: number; pt: number; tds: number; total: number; net: number };

// FY window: April <fy> .. March <fy+1> (Indian financial year).
function fyMonths(fy: number): string[] {
  const months: string[] = [];
  for (let m = 4; m <= 12; m++) months.push(`${fy}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m++) months.push(`${fy + 1}-${String(m).padStart(2, "0")}`);
  return months;
}
const sum = (rows: MonthRow[], k: keyof MonthRow) => rows.reduce((a, r) => a + (r[k] as number), 0);

// Per-employee FY salary + TDS summary computed from ISSUED payslip snapshots
// (the numbers a CA needs for Form 16 / ITR). Only slips saved to history count
// — that is the issued record.
export default async function FySummary({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const now = new Date();
  const defaultFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const fy = /^\d{4}$/.test(sp.fy ?? "") ? Number(sp.fy) : defaultFy;
  const months = new Set(fyMonths(fy));

  let employees: Employee[] = [];
  try {
    employees = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
  } catch {
    return (
      <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <p style={{ color: "#9a2233", fontSize: 13 }}>The HR data service is unreachable right now.</p>
      </main>
    );
  }

  // Pull each employee's issued slips inside the FY window.
  const perEmployee: Array<{ e: Employee; rows: MonthRow[] }> = [];
  for (const e of employees) {
    let gens: GenRow[] = [];
    try {
      gens = ((await hrFetch<{ generated: GenRow[] }>(`/hr/employees/${e.seq}/generated`)).generated ?? []).filter(
        (g) => g.docType === "payslip" && months.has(g.ref.slice(-7)),
      );
    } catch {
      continue;
    }
    // Newest-first; keep only the LATEST issued slip per month (a regenerated
    // month supersedes the earlier issue).
    const seen = new Set<string>();
    const rows: MonthRow[] = [];
    for (const g of gens) {
      const month = g.ref.slice(-7);
      if (seen.has(month)) continue;
      seen.add(month);
      try {
        const snap = (await hrFetch<{ gen: { snapshot?: Payslip } }>(`/hr/employees/${e.seq}/generated/${g.docId}`)).gen.snapshot;
        if (!snap) continue;
        rows.push({
          month,
          gross: snap.earnings.gross,
          pf: snap.deductions.pf,
          esi: snap.deductions.esi,
          pt: snap.deductions.pt,
          tds: snap.deductions.tds,
          total: snap.deductions.total,
          net: snap.netPay,
        });
      } catch {
        /* skip unreadable snapshot */
      }
    }
    if (rows.length) perEmployee.push({ e, rows: rows.sort((a, b) => (a.month < b.month ? -1 : 1)) });
  }

  const monthLabel = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return `${new Date(y, mm - 1, 1).toLocaleString("en-GB", { month: "short" })} ${y}`;
  };

  return (
    <div className="ss-stage">
      <style dangerouslySetInnerHTML={{ __html: LETTERHEAD_CSS }} />
      <div className="ss-noprint" style={{ maxWidth: 840, margin: "0 auto 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <Link href="/payslips" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Payslips</Link>
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12.5, color: "#e5e7eb" }}>
            FY{" "}
            <input name="fy" defaultValue={String(fy)} style={{ width: 70, padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 }} />
          </label>
          <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Show</button>
          <PrintButton />
        </form>
      </div>

      <div className="ss-sheet">
        <Masthead variant="lean" />
        <div className="ss-title">
          <h1>SALARY &amp; TDS SUMMARY</h1>
          <div className="sub">Financial Year {fy}–{String((fy + 1) % 100).padStart(2, "0")} (April {fy} – March {fy + 1})</div>
        </div>
        <p className="ss-fine" style={{ textAlign: "center" }}>
          Employer: {COMPANY.legalName} · PAN: {COMPANY.pan} · CIN: {COMPANY.cin}. Computed from issued payslips.
        </p>

        {perEmployee.length === 0 ? (
          <p className="ss-body" style={{ marginTop: 18 }}>
            No issued payslips fall in this financial year. Generate slips from the Payslips section and save them to
            history — issued slips are the source of these numbers.
          </p>
        ) : (
          perEmployee.map(({ e, rows }) => (
            <div key={e.seq} style={{ marginTop: 22 }}>
              <h2 className="ss-sec">
                {e.name} — {e.employeeId}
                {e.pan ? <span style={{ color: "#5b6676", fontWeight: 400 }}> · PAN {e.pan}</span> : null}
              </h2>
              <table className="ss-ded">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="amt">Gross</th>
                    <th className="amt">PF</th>
                    <th className="amt">ESI</th>
                    <th className="amt">PT</th>
                    <th className="amt">TDS</th>
                    <th className="amt">Net Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.month}>
                      <td>{monthLabel(r.month)}</td>
                      <td className="amt">{r.gross.toLocaleString("en-IN")}</td>
                      <td className="amt">{r.pf.toLocaleString("en-IN")}</td>
                      <td className="amt">{r.esi.toLocaleString("en-IN")}</td>
                      <td className="amt">{r.pt.toLocaleString("en-IN")}</td>
                      <td className="amt">{r.tds.toLocaleString("en-IN")}</td>
                      <td className="amt">{r.net.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td>FY total ({rows.length} month{rows.length === 1 ? "" : "s"})</td>
                    <td className="amt">{sum(rows, "gross").toLocaleString("en-IN")}</td>
                    <td className="amt">{sum(rows, "pf").toLocaleString("en-IN")}</td>
                    <td className="amt">{sum(rows, "esi").toLocaleString("en-IN")}</td>
                    <td className="amt">{sum(rows, "pt").toLocaleString("en-IN")}</td>
                    <td className="amt">{sum(rows, "tds").toLocaleString("en-IN")}</td>
                    <td className="amt">{sum(rows, "net").toLocaleString("en-IN")}</td>
                  </tr>
                </tbody>
              </table>
              <p className="ss-fine">
                Total salary paid: {formatINR(sum(rows, "gross"))} · Total TDS deducted: {formatINR(sum(rows, "tds"))}
              </p>
            </div>
          ))
        )}

        <p className="ss-fine" style={{ marginTop: 20 }}>
          This is a computer-generated summary for statutory preparation (Form 16 / ITR). Verify figures against bank
          records before filing; {COMPANY.legalName} retains responsibility for statutory filing.
        </p>
        <div className="ss-foot">
          <span>Salary &amp; TDS Summary — FY {fy}–{String((fy + 1) % 100).padStart(2, "0")}</span>
          <span className="c">
            {COMPANY.legalName} | CIN: {COMPANY.cin}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
