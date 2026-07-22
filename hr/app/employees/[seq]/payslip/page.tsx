import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildPayslip, prorateStructure, type DeductionConfig, type PayPeriod } from "@/lib/payslip";
import { toPayslipEmployee, type Employee } from "@/lib/employee";
import { PayslipDoc } from "@/components/PayslipDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Salary slip", robots: { index: false, follow: false } };

const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };
const cfgBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

function lastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildPeriod(month: string, lop: number): PayPeriod {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" });
  const pd = new Date(y, m, 5); // 5th of the following month
  return {
    monthLabel: `${monthName} ${y}`,
    periodLabel: `01 - ${days} ${monthName} ${y}`,
    standardDays: days,
    daysPaid: Math.max(0, days - lop),
    lopDays: lop,
    payDate: `${String(pd.getDate()).padStart(2, "0")} ${pd.toLocaleString("en-GB", { month: "long" })} ${pd.getFullYear()}`,
  };
}

export default async function GeneratePayslip({
  params,
  searchParams,
}: {
  params: Promise<{ seq: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { seq } = await params;
  const sp = await searchParams;

  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : lastMonth();
  const lop = Math.max(0, Number(sp.lop) || 0);
  const period = buildPeriod(month, lop);

  // Deduction defaults: on a fresh open (no deduction params in the URL),
  // prefill from this employee's LAST ISSUED slip — the owner shouldn't re-tick
  // PF / re-type TDS every month, and a forgotten tick silently changes net pay.
  const hasParams = ["pf", "esi", "pt", "tds", "lop", "pfCap"].some((k) => sp[k] !== undefined);
  let prev: { pf: number; esi: number; pt: number; tds: number } | null = null;
  if (!hasParams) {
    try {
      const gens = (await hrFetch<{ generated: Array<{ docId: string; docType: string }> }>(`/hr/employees/${seq}/generated`)).generated ?? [];
      const lastSlip = gens.find((g) => g.docType === "payslip"); // newest-first
      if (lastSlip) {
        const g = await hrFetch<{ gen: { snapshot?: { deductions?: { pf: number; esi: number; pt: number; tds: number } } } }>(
          `/hr/employees/${seq}/generated/${lastSlip.docId}`,
        );
        prev = g.gen.snapshot?.deductions ?? null;
      }
    } catch {
      /* defaults are best-effort */
    }
  }
  const on = (k: string, prevOn: boolean) => (hasParams ? sp[k] === "on" : prevOn);
  const cfg: DeductionConfig = {
    pf: { enabled: on("pf", (prev?.pf ?? 0) > 0), capAtWageCeiling: sp.pfCap === "on" },
    esi: { enabled: on("esi", (prev?.esi ?? 0) > 0) },
    pt: { enabled: on("pt", (prev?.pt ?? 0) > 0), amount: hasParams ? Number(sp.ptAmt) || 0 : prev?.pt ?? 0 },
    tds: { enabled: on("tds", (prev?.tds ?? 0) > 0), amount: hasParams ? Number(sp.tdsAmt) || 0 : prev?.tds ?? 0 },
  };

  // LOP proration: earnings scale by (standardDays - LOP) / standardDays — the
  // slip must never state LOP days while paying the full month.
  const earnings = prorateStructure(e.structure, lop, period.standardDays);

  const payslip = buildPayslip({
    employee: toPayslipEmployee(e),
    period,
    earnings,
    deductionConfig: cfg,
    remarks: `Salary for ${period.monthLabel} credited to the employee's bank account on ${period.payDate} via ${e.paymentMode.toLowerCase()}.`,
  });

  // No-print config bar — set month + deductions on the generate step and Update.
  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", fontSize: 12.5 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800, marginBottom: 8 }}>
        {e.name} · {e.employeeId}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        <label>Month <input type="month" name="month" defaultValue={month} style={cfgInput} /></label>
        <label><input type="checkbox" name="pf" defaultChecked={cfg.pf?.enabled} /> PF <span style={{ color: "#8a94a3" }}>(<input type="checkbox" name="pfCap" defaultChecked={sp.pfCap === "on"} /> cap ₹15k)</span></label>
        <label><input type="checkbox" name="esi" defaultChecked={cfg.esi?.enabled} /> ESI</label>
        <label><input type="checkbox" name="pt" defaultChecked={cfg.pt?.enabled} /> PT ₹<input name="ptAmt" defaultValue={String(cfg.pt?.amount ?? 0)} style={{ ...cfgInput, width: 60 }} /></label>
        <label><input type="checkbox" name="tds" defaultChecked={cfg.tds?.enabled} /> TDS ₹<input name="tdsAmt" defaultValue={String(cfg.tds?.amount ?? 0)} style={{ ...cfgInput, width: 72 }} /></label>
        <label>LOP <input name="lop" defaultValue={sp.lop ?? "0"} style={{ ...cfgInput, width: 50 }} /></label>
        <button type="submit" style={cfgBtn}>Update</button>
        {!hasParams && prev ? <span style={{ color: "#8a94a3", fontSize: 11 }}>Deductions prefilled from the last issued slip</span> : null}
      </div>
    </form>
  );

  return (
    <PayslipDoc
      payslip={payslip}
      toolbar={
        <>
          <DocToolbar
            backHref={`/payslips?month=${month}`}
            backLabel="Payslips"
            save={{ seq, docType: "payslip", title: `Salary Slip - ${period.monthLabel}`, ref: `${e.employeeId} ${month}`, snapshot: payslip }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Salary Slip — ${period.monthLabel}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
