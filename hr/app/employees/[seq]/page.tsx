import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { formatINR } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";
import { KycSection } from "@/components/KycSection";
import { DeleteEmployeeButton } from "@/components/DeleteEmployeeButton";
import { OffboardControl } from "@/components/OffboardControl";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee — ShieldSync HR", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; generatedBy: string; generatedAt: string };

const DOCTYPE_LABEL: Record<string, string> = {
  offer: "Appointment letter",
  payslip: "Salary slip",
  verification: "Verification letter",
  experience: "Experience / relieving letter",
  leave: "Leave approval letter",
  increment: "Salary revision letter",
  confirmation: "Confirmation letter",
  "internship-offer": "Internship offer",
  completion: "Certificate of completion",
};

const row = (k: string, v?: string | number) => (
  <div style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 12.5 }}>
    <div style={{ width: 150, color: "#8a94a3", flex: "none" }}>{k}</div>
    <div style={{ color: "#1b2331" }}>{v || "—"}</div>
  </div>
);

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 };
const cardTitle: React.CSSProperties = { fontWeight: 700, color: "#1f3a5f", fontSize: 14 };
const groupTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 8 };
const btn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", textDecoration: "none", fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "8px 12px", display: "inline-block" };
const linkBtn: React.CSSProperties = { color: "#2f4fb0", fontSize: 12.5, fontWeight: 600, textDecoration: "none" };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function EmployeeDetail({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }
  let generated: Gen[] = [];
  try {
    generated = (await hrFetch<{ generated: Gen[] }>(`/hr/employees/${seq}/generated`)).generated ?? [];
  } catch {
    /* history is best-effort */
  }

  const s = e.structure;
  const exited = e.status === "exited";
  const isIntern = /internship/i.test(e.employmentType);

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/employees" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Employees</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 21, fontWeight: 800, color: "#1f3a5f" }}>{e.name}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: exited ? "#fdecef" : "#e7f6ee", color: exited ? "#9a2233" : "#1a7a45" }}>
              {exited ? "Exited" : "Active"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#5b6676", marginTop: 2 }}>
            <span style={{ fontFamily: "monospace" }}>{e.employeeId}</span> · {e.designation}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link href={`/employees/${seq}/edit`} style={linkBtn}>Edit record</Link>
          <DeleteEmployeeButton seq={seq} name={e.name} employeeId={e.employeeId} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={card}>
          <div style={groupTitle}>Record</div>
          {row("Department", e.department)}
          {row("Date of joining", e.dateOfJoining)}
          {exited ? row("Last working day", e.lastWorkingDay) : null}
          {row("Employment", e.employmentType)}
          {row("Location", e.baseLocation)}
          {row("PAN", e.pan)}
          {row("Bank A/C", e.bankAccount)}
          {row("UAN / PF", e.uanPf)}
        </div>
        <div style={card}>
          <div style={groupTitle}>Compensation</div>
          {row("Gross / month", formatINR(e.grossMonthly))}
          {row("Annual CTC", formatINR(e.annualCTC))}
          {row("Basic", formatINR(s.basic))}
          {row("HRA", formatINR(s.hra))}
          {row("Conveyance", formatINR(s.conveyance))}
          {row("Special", formatINR(s.special))}
          {(e.revisions ?? []).length > 0 ? (
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: "#8a94a3", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>History</div>
              {(e.revisions ?? []).map((r, i) => (
                <div key={i} style={{ fontSize: 11.5, color: "#5b6676", padding: "2px 0" }}>
                  {formatINR(r.grossMonthly)}/mo until {r.effectiveDate} — {r.reason}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Employment status / offboarding */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={groupTitle}>Employment status</div>
        <OffboardControl seq={seq} status={e.status} lastWorkingDay={e.lastWorkingDay} />
      </div>

      {/* Generate documents */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={cardTitle}>Letters</div>
          <p style={{ fontSize: 12, color: "#5b6676", margin: "6px 0 10px" }}>Branded, pre-signed letters from this record.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {isIntern ? (
              <Link href={`/employees/${seq}/internship-offer`} style={btn}>Internship offer</Link>
            ) : (
              <Link href={`/employees/${seq}/offer`} style={btn}>Appointment letter</Link>
            )}
            <Link href={`/employees/${seq}/verification`} style={{ ...btn, background: "#2f4fb0" }}>Verification</Link>
            <Link href={`/employees/${seq}/leave`} style={{ ...btn, background: "#2f4fb0" }}>Leave approval</Link>
            {!isIntern ? (
              <Link href={`/employees/${seq}/confirmation`} style={{ ...btn, background: "#2f4fb0" }}>Probation confirmation</Link>
            ) : null}
            {isIntern ? (
              <Link
                href={`/employees/${seq}/completion`}
                style={exited ? { ...btn, background: "#2f4fb0" } : { ...btn, background: "#c3cee0" }}
                title={exited ? "" : "Mark the intern exited (internship end) first"}
              >
                Completion certificate{exited ? "" : " (needs end)"}
              </Link>
            ) : (
              <Link
                href={`/employees/${seq}/experience`}
                style={exited ? { ...btn, background: "#2f4fb0" } : { ...btn, background: "#c3cee0" }}
                title={exited ? "" : "Mark the employee exited first"}
              >
                Experience / relieving{exited ? "" : " (needs exit)"}
              </Link>
            )}
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 10 }}>
            <Link href={`/employees/${seq}/revise`} style={linkBtn}>Revise salary (issues revision letter) &rarr;</Link>
          </div>
        </div>

        <div style={card}>
          <div style={cardTitle}>Salary slip</div>
          <p style={{ fontSize: 12, color: "#5b6676", margin: "6px 0 12px" }}>
            Generate this employee’s monthly slip — month and deductions (PF / ESI / PT / TDS / LOP) are set on the
            generate screen.
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={`/employees/${seq}/payslip`} style={btn}>Generate payslip</Link>
            <Link href="/payslips" style={linkBtn}>All payslips &rarr;</Link>
          </div>
        </div>
      </div>

      {/* Issued document history */}
      <div style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={cardTitle}>Issued documents</div>
          <div style={{ fontSize: 10.5, color: "#8a94a3" }}>Re-open re-renders exactly as issued</div>
        </div>
        {generated.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#8a94a3", marginTop: 8 }}>Nothing issued yet. Generate a document above and click “Save to history”.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 }}>
            <tbody>
              {generated.map((g) => (
                <tr key={g.docId} style={{ borderTop: "1px solid #eef2f7" }}>
                  <td style={{ padding: "8px 6px", color: "#1f3a5f", fontWeight: 600, width: 190 }}>{DOCTYPE_LABEL[g.docType] ?? g.docType}</td>
                  <td style={{ padding: "8px 6px", color: "#5b6676", fontFamily: "monospace", fontSize: 11.5 }}>{g.ref}</td>
                  <td style={{ padding: "8px 6px", color: "#8a94a3", whiteSpace: "nowrap" }}>{fmtWhen(g.generatedAt)}</td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    <Link href={`/employees/${seq}/issued/${g.docId}`} style={linkBtn}>Re-open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <KycSection seq={seq} />
    </main>
  );
}
