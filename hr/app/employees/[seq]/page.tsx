import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can, MASKED } from "@/lib/access";
import { formatINR } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";
import { KycSection } from "@/components/KycSection";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { DeleteEmployeeButton } from "@/components/DeleteEmployeeButton";
import { OffboardControl } from "@/components/OffboardControl";
import { SelfPinControl } from "@/components/SelfPinControl";
import { VisibilityControl } from "@/components/VisibilityControl";
import { AcceptedBadge } from "@/components/AcceptedBadge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee — ShieldSync HR", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; generatedBy: string; generatedAt: string; acceptedAt?: string | null };

const DOCTYPE_LABEL: Record<string, string> = {
  offer: "Appointment letter",
  payslip: "Salary slip",
  verification: "Verification letter",
  experience: "Experience / relieving letter",
  leave: "Leave approval letter",
  increment: "Salary revision letter",
  confirmation: "Confirmation letter",
  "internship-offer": "Letter of Intent — Internship",
  completion: "Certificate of completion",
  "employment-history": "Employment history certificate",
  "resignation-acceptance": "Resignation acceptance letter",
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

  // Leaves taken (derived from issued leave letters — no ledger bloat): sum the
  // structured _meta each leave snapshot carries, grouped by calendar year.
  const leaveGens = generated.filter((g) => g.docType === "leave");
  const leavesByYear = new Map<string, { days: number; letters: number }>();
  await Promise.all(
    leaveGens.map(async (g) => {
      try {
        const snap = (await hrFetch<{ gen: { snapshot?: { _meta?: { leaveFrom?: string; totalDays?: number } } } }>(
          `/hr/employees/${seq}/generated/${g.docId}`,
        )).gen.snapshot;
        const meta = snap?._meta;
        if (!meta?.totalDays) return;
        const year = (meta.leaveFrom ?? "").slice(0, 4) || "—";
        const cur = leavesByYear.get(year) ?? { days: 0, letters: 0 };
        cur.days += meta.totalDays;
        cur.letters += 1;
        leavesByYear.set(year, cur);
      } catch {
        /* best-effort */
      }
    }),
  );

  const s = e.structure;
  const exited = e.status === "exited";
  const isIntern = /internship/i.test(e.employmentType);

  // Field-level visibility. Opening a colleague's record and knowing what they
  // earn are separate decisions, so these are separate permissions — and the
  // masking has to happen HERE, on the server, because the middleware can only
  // gate whole URLs, not individual fields.
  const { isAdmin, access } = await getViewer();
  const showSalary = isAdmin || access.seeSalary;
  const showBank = isAdmin || access.seeBankDetails;
  const money = (n: number) => (showSalary ? formatINR(n) : MASKED);

  // Per-action gates: a control renders only when the viewer could actually use
  // the route behind it (admin always passes), so nothing here dead-ends at
  // /no-access. Requirements mirror hr/lib/access-routes.ts exactly.
  const canWriteDocs = isAdmin || can(access, "documents", "write"); // letter builders
  const canWriteEmp = isAdmin || can(access, "employees", "write"); // offboard / delete (no salary)
  const canEditRecord = isAdmin || (can(access, "employees", "write") && access.seeSalary); // edit / revise / convert set pay
  const canRunPayroll = isAdmin || (can(access, "payroll", "write") && access.seeSalary); // generate payslip
  const canReadPayroll = isAdmin || (can(access, "payroll", "read") && access.seeSalary); // /payslips org view
  const canKyc = isAdmin || can(access, "kyc", "read");

  // Admin-only visibility toggle state. Best-effort: if it can't be read the
  // control simply doesn't render this load (the middleware gate is unaffected).
  let restricted = false;
  if (isAdmin) {
    try {
      const a = await hrFetch<{ restrictedSeqs?: number[] }>("/hr/access");
      restricted = (a.restrictedSeqs ?? []).includes(Number(seq));
    } catch { /* toggle hidden this load */ }
  }

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
          {isAdmin ? <VisibilityControl seq={Number(seq)} restricted={restricted} /> : null}
          {canEditRecord ? <Link href={`/employees/${seq}/edit`} style={linkBtn}>Edit record</Link> : null}
          {canWriteEmp ? <DeleteEmployeeButton seq={seq} name={e.name} employeeId={e.employeeId} /> : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 20 }}>
        <div style={card}>
          <div style={groupTitle}>Record</div>
          {row("Department", e.department)}
          {row("Date of joining", e.dateOfJoining)}
          {exited ? row("Last working day", e.lastWorkingDay) : null}
          {row("Employment", e.employmentType)}
          {row("Location", e.baseLocation)}
          {row("PAN", showBank ? e.pan : MASKED)}
          {row("Bank A/C", showBank ? e.bankAccount : MASKED)}
          {row("UAN / PF", e.uanPf)}
          {leavesByYear.size > 0 ? (
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: "#8a94a3", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Leaves taken (issued letters)</div>
              {[...leavesByYear.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([year, v]) => (
                <div key={year} style={{ fontSize: 11.5, color: "#5b6676", padding: "2px 0" }}>
                  {year}: <b style={{ color: "#1f3a5f" }}>{v.days} days</b> across {v.letters} letter{v.letters === 1 ? "" : "s"}
                </div>
              ))}
            </div>
          ) : null}
          {(e.transitions ?? []).length > 0 ? (
            <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: "#8a94a3", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>Transitions</div>
              {(e.transitions ?? []).map((t, i) => (
                <div key={i} style={{ fontSize: 11.5, color: "#5b6676", padding: "2px 0" }}>
                  {t.from} → <b style={{ color: "#1f3a5f" }}>{t.to}</b> w.e.f. {t.effectiveDate}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={card}>
          <div style={groupTitle}>Compensation</div>
          {!showSalary ? (
            <div style={{ fontSize: 11.5, color: "#8a94a3", lineHeight: 1.5, marginBottom: 6 }}>
              Salary figures aren&rsquo;t part of your access.
            </div>
          ) : null}
          {row("Gross / month", money(e.grossMonthly))}
          {row("Annual CTC", money(e.annualCTC))}
          {row("Basic", money(s.basic))}
          {row("HRA", money(s.hra))}
          {row("Conveyance", money(s.conveyance))}
          {row("Special", money(s.special))}
          {showSalary && (e.revisions ?? []).length > 0 ? (
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

      {/* Employment status / offboarding — the status itself is shown in the
          header badge above; this card is the write control, so it renders only
          for someone who can actually change it (its POST needs employees:write). */}
      {canWriteEmp ? (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={groupTitle}>Employment status</div>
          <OffboardControl seq={seq} status={e.status} lastWorkingDay={e.lastWorkingDay} />
        </div>
      ) : null}

      {/* Generate documents */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        {/* Letters — hidden entirely when the viewer can neither issue letters
            (documents:write) nor edit the record, so the card never renders empty. */}
        {canWriteDocs || canEditRecord ? (
          <div style={card}>
            <div style={cardTitle}>Letters</div>
            <p style={{ fontSize: 12, color: "#5b6676", margin: "6px 0 10px" }}>Branded, pre-signed letters from this record.</p>
            {canWriteDocs ? (
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
                {/* Resignation acceptance — a regular-employee exit letter, issued
                    when notice is tendered (may still be active), so no exit gate;
                    interns use the completion certificate instead. */}
                {!isIntern ? (
                  <Link href={`/employees/${seq}/resignation-acceptance`} style={{ ...btn, background: "#2f4fb0" }}>
                    Resignation acceptance
                  </Link>
                ) : null}
                {exited && (e.transitions?.length ?? 0) > 0 ? (
                  <Link href={`/employees/${seq}/employment-history`} style={{ ...btn, background: "#2f4fb0" }}>
                    Employment history
                  </Link>
                ) : null}
              </div>
            ) : null}
            {canEditRecord ? (
              <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <Link href={`/employees/${seq}/revise`} style={linkBtn}>Revise salary &rarr;</Link>
                {isIntern && !exited ? (
                  <Link href={`/employees/${seq}/convert`} style={linkBtn}>Convert to full-time &rarr;</Link>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Salary slip — hidden unless the viewer can generate a slip or open the
            org payroll view; both need the salary permission, so a payroll-read
            user without it never sees a dead card. */}
        {canRunPayroll || canReadPayroll ? (
          <div style={card}>
            <div style={cardTitle}>Salary slip</div>
            <p style={{ fontSize: 12, color: "#5b6676", margin: "6px 0 12px" }}>
              Generate this employee’s monthly slip — month and deductions (PF / ESI / PT / TDS / LOP) are set on the
              generate screen.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {canRunPayroll ? <Link href={`/employees/${seq}/payslip`} style={btn}>Generate payslip</Link> : null}
              {canReadPayroll ? (
                <Link href={`/payslips?month=${new Date().toISOString().slice(0, 7)}`} style={linkBtn}>Org payroll view &rarr;</Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ ...card, marginTop: 16 }}>
        <div style={cardTitle}>Self-serve access</div>
        <p style={{ fontSize: 12, color: "#5b6676", margin: "6px 0 12px" }}>
          Lets {e.name.split(" ")[0]} sign in at <b>/my/login</b> with their Employee ID and this PIN to view (read-only)
          whatever has been issued to them here — nothing else in the portal.
        </p>
        {/* Admin only — issuing a PIN hands over a login credential, so the
            control must not appear for staff whose POST would 403 anyway. */}
        {isAdmin ? (
          <SelfPinControl seq={seq} employeeId={e.employeeId} hasPin={Boolean(e.hasSelfPin)} />
        ) : (
          <p style={{ fontSize: 12, color: "#8a94a3" }}>Only the administrator can issue or reset a self-serve PIN.</p>
        )}
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
                  <td style={{ padding: "8px 6px", color: "#8a94a3", whiteSpace: "nowrap" }}>
                    {fmtWhen(g.generatedAt)}
                    {g.acceptedAt ? (
                      <div style={{ marginTop: 4 }}>
                        <AcceptedBadge seq={seq} genId={g.docId} acceptedAt={g.acceptedAt} isAdmin={isAdmin} />
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 6px", textAlign: "right" }}>
                    <Link href={`/employees/${seq}/issued/${g.docId}`} style={linkBtn}>Re-open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Onboarding checklist + ID vault share the same KYC permission gate.
          The checklist is a read-only summary of what has been uploaded — no
          reason to gate it separately from the vault that backs it. */}
      {canKyc ? (
        <>
          <OnboardingChecklist seq={seq} />
          <KycSection seq={seq} canWrite={isAdmin || can(access, "kyc", "write")} />
        </>
      ) : null}
    </main>
  );
}
