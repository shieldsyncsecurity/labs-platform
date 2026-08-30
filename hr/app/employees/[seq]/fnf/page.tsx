import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import { buildPayslip, prorateStructure, type DeductionConfig, type PayPeriod } from "@/lib/payslip";
import { buildFnfSettlement } from "@/lib/documents/letters";
import { structureForMonth, toPayslipEmployee, type Employee, PAYMENT_MODE_OPTIONS } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Full & Final settlement", robots: { index: false, follow: false } };

const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };
const cfgBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

// Cash has no bank leg — same fix as the payslip's paymentRemark(), reworded
// for a settlement statement's future-tense "will be paid" framing.
function payoutNote(payDate: string, mode: string): string {
  if (mode.trim().toLowerCase() === "cash") return `paid in cash on ${payDate}`;
  return `credited to your bank account on ${payDate} via ${mode.toLowerCase()}`;
}

function defaultPayIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const pd = new Date(y, m, 5); // 5th of the month AFTER the settled month
  return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}-${String(pd.getDate()).padStart(2, "0")}`;
}

function buildPeriod(month: string, lop: number, payDateIso?: string): PayPeriod {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" });
  const pd = /^\d{4}-\d{2}-\d{2}$/.test(payDateIso ?? "") ? new Date(payDateIso as string) : new Date(y, m, 5);
  return {
    monthLabel: `${monthName} ${y}`,
    periodLabel: `01 - ${days} ${monthName} ${y}`,
    standardDays: days,
    daysPaid: Math.max(0, days - lop),
    lopDays: lop,
    payDate: `${String(pd.getDate()).padStart(2, "0")} ${pd.toLocaleString("en-GB", { month: "long" })} ${pd.getFullYear()}`,
  };
}

export default async function GenerateFnf({
  params,
  searchParams,
}: {
  params: Promise<{ seq: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { seq } = await params;
  const sp = await searchParams;

  const { isAdmin, access } = await getViewer();
  const canIssue = isAdmin || can(access, "documents", "write");

  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  // An F&F settlement only makes sense once someone has actually exited —
  // mirrors the experience/relieving letter's own gate.
  if (e.status !== "exited" || !e.lastWorkingDay) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Full &amp; Final settlement</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name} is still <b>active</b>. Mark them <b>exited</b> with a last working day (on their page) before
          issuing a Full &amp; Final settlement.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  // Defaults to the month the last working day falls in — the final month
  // being settled — rather than "last calendar month" like the routine
  // payslip screen, since this is specifically about the exit month.
  const lwdParsed = new Date(e.lastWorkingDay);
  const defaultMonth = Number.isNaN(lwdParsed.getTime())
    ? new Date().toISOString().slice(0, 7)
    : `${lwdParsed.getFullYear()}-${String(lwdParsed.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : defaultMonth;
  const lop = Math.max(0, Math.round(Number(sp.lop) || 0));
  const payDateIso = /^\d{4}-\d{2}-\d{2}$/.test(sp.payDate ?? "") ? (sp.payDate as string) : defaultPayIso(month);
  const period = buildPeriod(month, lop, payDateIso);

  type GenSummary = { docId: string; docType: string; ref: string; generatedAt: string };
  let gens: GenSummary[] = [];
  try {
    gens = (await hrFetch<{ generated: GenSummary[] }>(`/hr/employees/${seq}/generated`)).generated ?? [];
  } catch {
    /* best-effort */
  }
  // Warn on a duplicate the same way the payslip screen does — an F&F is
  // meant to be issued once; a second one for the same employee is almost
  // certainly a mistake, not a legitimate re-issue.
  const existingFnf = gens.filter((g) => g.docType === "fnf");
  const existingPayslipForMonth = gens.filter((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`));

  const hasParams = ["pf", "esi", "pt", "tds", "lop", "pfCap"].some((k) => sp[k] !== undefined);
  let prev: { pf: number; esi: number; pt: number; tds: number } | null = null;
  let prevCfg: DeductionConfig | null = null;
  if (!hasParams) {
    try {
      const lastSlip = gens.find((g) => g.docType === "payslip");
      if (lastSlip) {
        const g = await hrFetch<{ gen: { snapshot?: { deductions?: { pf: number; esi: number; pt: number; tds: number }; config?: DeductionConfig } } }>(
          `/hr/employees/${seq}/generated/${lastSlip.docId}`,
        );
        prev = g.gen.snapshot?.deductions ?? null;
        prevCfg = g.gen.snapshot?.config ?? null;
      }
    } catch {
      /* defaults are best-effort */
    }
  }
  const on = (k: string, prevOn: boolean) => (hasParams ? sp[k] === "on" : prevOn);
  const cfg: DeductionConfig = {
    pf: {
      enabled: on("pf", prevCfg?.pf?.enabled ?? (prev?.pf ?? 0) > 0),
      capAtWageCeiling: hasParams ? sp.pfCap === "on" : (prevCfg?.pf?.capAtWageCeiling ?? false),
    },
    esi: { enabled: on("esi", prevCfg?.esi?.enabled ?? (prev?.esi ?? 0) > 0) },
    pt: { enabled: on("pt", prevCfg?.pt?.enabled ?? (prev?.pt ?? 0) > 0), amount: hasParams ? Number(sp.ptAmt) || 0 : (prevCfg?.pt?.amount ?? prev?.pt ?? 0) },
    tds: { enabled: on("tds", prevCfg?.tds?.enabled ?? (prev?.tds ?? 0) > 0), amount: hasParams ? Number(sp.tdsAmt) || 0 : (prevCfg?.tds?.amount ?? prev?.tds ?? 0) },
  };

  const paymentMode = sp.mode?.trim() || e.paymentMode || "Bank Transfer";

  const monthEndIso = `${month}-${String(period.standardDays).padStart(2, "0")}`;
  const { structure: monthStructure } = structureForMonth(e, monthEndIso);
  const earnings = prorateStructure(monthStructure, lop, period.standardDays);

  const payslip = buildPayslip({
    employee: { ...toPayslipEmployee(e), paymentMode },
    period,
    earnings,
    deductionConfig: cfg,
    contractedGross: monthStructure.gross,
  });

  const now = new Date();
  const letter = buildFnfSettlement(e, {
    ref: sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`,
    date: sp.date?.trim() || e.lastWorkingDay,
    monthLabel: period.monthLabel,
    earnings: payslip.earnings,
    deductions: payslip.deductions,
    netPay: payslip.netPay,
    netPayWords: payslip.netPayWords,
    payoutNote: payoutNote(period.payDate, paymentMode),
  });

  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", fontSize: 12.5 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800, marginBottom: 8 }}>
        {e.name} · {e.employeeId} · settling {period.monthLabel}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
        <label>Month <input type="month" name="month" defaultValue={month} style={cfgInput} /></label>
        <label>Payment date <input type="date" name="payDate" defaultValue={payDateIso} style={cfgInput} /></label>
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
        <label>Statement date <input name="date" defaultValue={sp.date ?? e.lastWorkingDay} style={{ ...cfgInput, width: 150 }} /></label>
        <input type="hidden" name="ref" value={sp.ref ?? ""} />
        <button type="submit" style={cfgBtn}>Update</button>
        {!hasParams && prev ? <span style={{ fontSize: 11, color: "#8a94a3" }}>Deductions prefilled from the last issued slip</span> : null}
      </div>
    </form>
  );

  const warnings: string[] = [];
  if (existingFnf.length > 0) warnings.push(`${e.name} already has an F&F settlement issued (${existingFnf.map((g) => g.ref).join(", ")}).`);
  if (existingPayslipForMonth.length > 0) warnings.push(`${period.monthLabel} already has a regular salary slip issued (${existingPayslipForMonth.map((g) => g.ref).join(", ")}) — issuing this too would pay the month twice.`);

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <>
          {warnings.length > 0 ? (
            <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.6, marginBottom: 8 }}>
              {warnings.map((w, i) => <div key={i}><b>{i === 0 ? "Warning: " : ""}</b>{w}</div>)}
            </div>
          ) : null}
          {/* Config-first: set month/deductions before the act buttons. */}
          {configBar}
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            canIssue={canIssue}
            save={{ seq, docType: "fnf", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Full & Final Settlement — ${e.name}` }}
            confirmBeforeSave={warnings.length > 0 ? `${warnings.join("\n\n")}\n\nSave this Full & Final settlement anyway?` : undefined}
          />
        </>
      }
    />
  );
}
