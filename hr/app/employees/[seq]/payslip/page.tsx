import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import { buildPayslip, prorateStructure, type DeductionConfig, type PayPeriod } from "@/lib/payslip";
import { structureForMonth, toPayslipEmployee, type Employee } from "@/lib/employee";
import { PayslipDoc } from "@/components/PayslipDoc";
import { DocToolbar } from "@/components/DocToolbar";
import { PAYMENT_MODE_OPTIONS } from "@/lib/employee";

/** Cash has no bank leg — "credited to the employee's bank account ... via
 * cash" is nonsensical and was printing on every cash-paid slip. Every other
 * mode (Bank Transfer, UPI, Cheque) genuinely does land in a bank account. */
function paymentRemark(monthLabel: string, payDate: string, mode: string): string {
  if (mode.trim().toLowerCase() === "cash") {
    return `Salary for ${monthLabel} paid in cash to the employee on ${payDate}.`;
  }
  return `Salary for ${monthLabel} credited to the employee's bank account on ${payDate} via ${mode.toLowerCase()}.`;
}

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

// Salary is credited on the 5th of the following month by default; the actual
// credit date varies (bank holidays, a delayed run), so it's overridable via a
// payDate=YYYY-MM-DD param. defaultPayIso() gives the 5th for the date picker.
function defaultPayIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const pd = new Date(y, m, 5); // 5th of the month AFTER the salary month
  return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}-${String(pd.getDate()).padStart(2, "0")}`;
}

function buildPeriod(month: string, lop: number, payDateIso?: string): PayPeriod {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" });
  const pd = /^\d{4}-\d{2}-\d{2}$/.test(payDateIso ?? "")
    ? new Date(payDateIso as string)
    : new Date(y, m, 5); // default: 5th of the following month
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

  // Issuing (Save to history), emailing and printing a slip all POST to routes
  // that require Letters (documents) WRITE. A viewer with payroll+salary but
  // without that can build and read this slip but not archive it — pass that
  // through so the toolbar shows an honest view-only note instead of buttons
  // that all 403. (Admin always passes.)
  const { isAdmin, access } = await getViewer();
  const canIssue = isAdmin || can(access, "documents", "write");

  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : lastMonth();
  const lop = Math.max(0, Number(sp.lop) || 0);
  const payDateIso = /^\d{4}-\d{2}-\d{2}$/.test(sp.payDate ?? "") ? (sp.payDate as string) : defaultPayIso(month);
  const period = buildPeriod(month, lop, payDateIso);

  // Fetched once, used two ways below: (1) prefill deduction defaults from the
  // last issued slip, and (2) detect whether a slip for THIS month already
  // exists — nothing in the engine stops a second payslip being saved for the
  // same employee+month (fixed ref, no dedupe), so without this check it's
  // silently possible to double-issue a month's pay.
  type GenSummary = { docId: string; docType: string; ref: string; generatedAt: string };
  let gens: GenSummary[] = [];
  try {
    gens = (await hrFetch<{ generated: GenSummary[] }>(`/hr/employees/${seq}/generated`)).generated ?? [];
  } catch {
    /* best-effort */
  }
  const existingForMonth = gens.filter((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`));

  const hasParams = ["pf", "esi", "pt", "tds", "lop", "pfCap"].some((k) => sp[k] !== undefined);
  let prev: { pf: number; esi: number; pt: number; tds: number } | null = null;
  let prevCfg: DeductionConfig | null = null;
  if (!hasParams) {
    try {
      const lastSlip = gens.find((g) => g.docType === "payslip"); // newest-first
      if (lastSlip) {
        const g = await hrFetch<{ gen: { snapshot?: { deductions?: { pf: number; esi: number; pt: number; tds: number }; config?: DeductionConfig } } }>(
          `/hr/employees/${seq}/generated/${lastSlip.docId}`,
        );
        prev = g.gen.snapshot?.deductions ?? null;
        prevCfg = g.gen.snapshot?.config ?? null; // exact toggles incl. PF cap (newer snapshots)
      }
    } catch {
      /* defaults are best-effort */
    }
  }
  const on = (k: string, prevOn: boolean) => (hasParams ? sp[k] === "on" : prevOn);
  const cfg: DeductionConfig = {
    pf: {
      enabled: on("pf", prevCfg?.pf?.enabled ?? (prev?.pf ?? 0) > 0),
      // The cap must survive the prefill — otherwise PF silently jumps from
      // ₹1,800 to 12% of full basic on the next month's slip.
      capAtWageCeiling: hasParams ? sp.pfCap === "on" : (prevCfg?.pf?.capAtWageCeiling ?? false),
    },
    esi: { enabled: on("esi", prevCfg?.esi?.enabled ?? (prev?.esi ?? 0) > 0) },
    pt: { enabled: on("pt", prevCfg?.pt?.enabled ?? (prev?.pt ?? 0) > 0), amount: hasParams ? Number(sp.ptAmt) || 0 : (prevCfg?.pt?.amount ?? prev?.pt ?? 0) },
    tds: { enabled: on("tds", prevCfg?.tds?.enabled ?? (prev?.tds ?? 0) > 0), amount: hasParams ? Number(sp.tdsAmt) || 0 : (prevCfg?.tds?.amount ?? prev?.tds ?? 0) },
  };

  // The structure IN FORCE for the slip month — a salary revision applied today
  // must not change last month's slip (revision history holds the old comp).
  const monthEndIso = `${month}-${String(period.standardDays).padStart(2, "0")}`;
  const { structure: monthStructure, historical } = structureForMonth(e, monthEndIso);

  // LOP proration: earnings scale by (standardDays - LOP) / standardDays — the
  // slip must never state LOP days while paying the full month.
  const earnings = prorateStructure(monthStructure, lop, period.standardDays);

  // Payment mode for THIS slip — defaults to the employee's record, but
  // overridable per month (e.g. one cash-in-hand month for an otherwise
  // bank-paid employee, or vice versa) via the config bar below.
  const paymentMode = PAYMENT_MODE_OPTIONS.includes(sp.mode ?? "") ? (sp.mode as string) : (e.paymentMode || "Bank Transfer");

  const payslip = buildPayslip({
    // The mode override (above) must also win on the slip's own "Payment Mode"
    // field — otherwise a for-this-month override would read "paid in cash"
    // in the remark while the field above it still said "Bank Transfer".
    employee: { ...toPayslipEmployee(e), paymentMode },
    period,
    earnings,
    deductionConfig: cfg,
    remarks: paymentRemark(period.monthLabel, period.payDate, paymentMode),
  });

  // No-print config bar — set month + deductions on the generate step and Update.
  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", fontSize: 12.5 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800, marginBottom: 8 }}>
        {e.name} · {e.employeeId}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        <label>Month <input type="month" name="month" defaultValue={month} style={cfgInput} /></label>
        <label>Pay date <input type="date" name="payDate" defaultValue={payDateIso} style={cfgInput} /></label>
        <label>
          Paid via{" "}
          <select name="mode" defaultValue={paymentMode} style={cfgInput}>
            {PAYMENT_MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label><input type="checkbox" name="pf" defaultChecked={cfg.pf?.enabled} /> PF <span style={{ color: "#8a94a3" }}>(<input type="checkbox" name="pfCap" defaultChecked={sp.pfCap === "on"} /> cap ₹15k)</span></label>
        <label><input type="checkbox" name="esi" defaultChecked={cfg.esi?.enabled} /> ESI</label>
        <label><input type="checkbox" name="pt" defaultChecked={cfg.pt?.enabled} /> PT ₹<input name="ptAmt" type="number" min={0} defaultValue={String(cfg.pt?.amount ?? 0)} style={{ ...cfgInput, width: 70 }} /></label>
        <label><input type="checkbox" name="tds" defaultChecked={cfg.tds?.enabled} /> TDS ₹<input name="tdsAmt" type="number" min={0} defaultValue={String(cfg.tds?.amount ?? 0)} style={{ ...cfgInput, width: 82 }} /></label>
        <label>LOP <input name="lop" type="number" min={0} max={31} defaultValue={sp.lop ?? "0"} style={{ ...cfgInput, width: 58 }} /></label>
        <button type="submit" style={cfgBtn}>Update</button>
        {!hasParams && prev ? <span style={{ color: "#8a94a3", fontSize: 11 }}>Deductions prefilled from the last issued slip</span> : null}
        {historical ? (
          <span style={{ color: "#9a6a12", background: "#fdf4e3", border: "1px solid #f0dfb8", borderRadius: 6, padding: "3px 8px", fontSize: 11, fontWeight: 700 }}>
            Using the pre-revision salary structure in force for {period.monthLabel}
          </span>
        ) : null}
      </div>
    </form>
  );

  // Nothing server-side stops a second payslip for the same employee+month
  // (fixed ref, no dedupe) — so warn plainly and require an explicit confirm
  // before Save/Issue can create a duplicate.
  const dupWarning =
    existingForMonth.length > 0 ? (
      <div style={{ marginTop: 8, border: "1px solid #f0dfb8", background: "#fdf4e3", color: "#7a5714", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.6 }}>
        <b>{existingForMonth.length === 1 ? "A salary slip" : `${existingForMonth.length} salary slips`} for {period.monthLabel} {existingForMonth.length === 1 ? "already exists" : "already exist"}</b> for {e.name}:{" "}
        {existingForMonth.map((g, i) => (
          <span key={g.docId}>
            {i > 0 ? ", " : ""}
            <a href={`/employees/${seq}/issued/${g.docId}`} style={{ color: "#7a5714", textDecoration: "underline" }}>{g.ref || g.docId}</a>
          </span>
        ))}
        . Saving again creates a duplicate — open the link above first if you meant to correct or withdraw it instead.
      </div>
    ) : null;

  return (
    <PayslipDoc
      payslip={payslip}
      toolbar={
        <>
          <DocToolbar
            backHref={`/payslips?month=${month}`}
            backLabel="Payslips"
            canIssue={canIssue}
            save={{ seq, docType: "payslip", title: `Salary Slip - ${period.monthLabel}`, ref: `${e.employeeId} ${month}`, snapshot: payslip }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Salary Slip — ${period.monthLabel}` }}
            confirmBeforeSave={
              existingForMonth.length > 0
                ? `${e.name} already has ${existingForMonth.length === 1 ? "a salary slip" : `${existingForMonth.length} salary slips`} for ${period.monthLabel} (${existingForMonth.map((g) => g.ref || g.docId).join(", ")}).\n\nSave this as another one anyway?`
                : undefined
            }
          />
          {dupWarning}
          {configBar}
        </>
      }
    />
  );
}
