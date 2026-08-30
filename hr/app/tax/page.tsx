import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { requireAdminPage } from "@/lib/server/hr-access";
import {
  currentFY, fyMonths, tdsDueDate, advanceTaxSchedule, gstDueDates,
  obligationStatus, STATUS_STYLE, monthLabel, dueDateLabel,
} from "@/lib/tax";
import { formatINR } from "@/lib/banking";
import type { BankTxn } from "@/lib/banking";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tax obligations — ShieldSync HR", robots: { index: false, follow: false } };

type TdsByMonth = Record<string, { tds: number; pf: number; esi: number; netPay: number; payslipCount: number }>;

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: "18px 20px", background: "#fff", marginTop: 20 };
const sectionTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 };
const th: React.CSSProperties = { padding: "7px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", textAlign: "left" as const, fontWeight: 800 };
const td = (extra?: React.CSSProperties): React.CSSProperties => ({ padding: "9px 10px", fontSize: 13, borderTop: "1px solid #eef2f7", ...extra });

function StatusBadge({ status }: { status: ReturnType<typeof obligationStatus> }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export default async function TaxPage() {
  await requireAdminPage();

  const fy = currentFY();
  const months = fyMonths(fy.start);

  // TDS from payslips
  let tdsData: TdsByMonth = {};
  let loadFailed = false;
  try {
    tdsData = (await hrFetch<{ byMonth: TdsByMonth }>("/hr/tax/summary")).byMonth ?? {};
  } catch {
    loadFailed = true;
  }

  // All bank transactions in the "tax" category — these are the actual payments
  let taxPayments: BankTxn[] = [];
  try {
    const all = (await hrFetch<{ transactions: BankTxn[] }>("/hr/banking")).transactions ?? [];
    taxPayments = all.filter((t) => t.category === "tax" && t.debit > 0);
  } catch {
    // Don't present a failed load as real ₹0 tax figures.
    loadFailed = true;
  }

  // Group tax bank payments by the month BEFORE the payment month (i.e., what
  // salary month they likely cover). TDS paid in May covers April salary.
  // This is heuristic — the user should tag remarks for clarity.
  const taxPaidByFollowingMonth = new Map<string, number>();
  for (const t of taxPayments) {
    taxPaidByFollowingMonth.set(t.month, (taxPaidByFollowingMonth.get(t.month) ?? 0) + t.debit);
  }

  // TDS row = salary month → bank payment is in the FOLLOWING month (or April 30 for March)
  const tdsRows = months.map((m) => {
    const data = tdsData[m];
    const tds = data?.tds ?? 0;
    const due = tdsDueDate(m);
    const paymentMonth = due.slice(0, 7); // YYYY-MM of due date = bank payment month
    const paid = taxPaidByFollowingMonth.get(paymentMonth) ?? 0;
    const hasPaid = paid > 0;
    const status = tds === 0 ? "future" as const : obligationStatus(due, hasPaid);
    return { month: m, tds, payslipCount: data?.payslipCount ?? 0, pf: data?.pf ?? 0, due, paid, hasPaid, status };
  });

  // Advance tax schedule
  const advTax = advanceTaxSchedule(fy.start);

  // GST — marked "pending" until registered. Hardcode registered=false for now.
  const gstRegistered = false; // flip to true once GSTIN is received

  const totalTds = tdsRows.reduce((s, r) => s + r.tds, 0);
  const totalTdsPaid = taxPayments.reduce((s, t) => s + t.debit, 0);
  const overdueRows = tdsRows.filter((r) => r.status === "overdue");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Home</Link>

      {loadFailed ? (
        <div style={{ marginTop: 12, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "10px 12px" }}>
          Couldn&rsquo;t load tax data just now — the figures below are <b>not reliable</b> (they may read ₹0 where data actually exists). Refresh in a moment.
        </div>
      ) : null}

      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Tax obligations</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676", marginTop: 4 }}>
            {fy.label} · Derived from payslips + IDFC bank transactions tagged <b>Tax (GST / TDS)</b>.
          </p>
        </div>
        <Link href="/banking" style={{ fontSize: 12.5, color: "#2f4fb0", fontWeight: 600 }}>
          Bank ledger &rarr;
        </Link>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 20 }}>
        {[
          { label: `TDS deducted ${fy.label}`, value: formatINR(totalTds), sub: `from ${tdsRows.filter(r => r.payslipCount > 0).length} months of payslips`, color: "#1f3a5f" },
          { label: "Tax payments in bank", value: formatINR(totalTdsPaid), sub: `${taxPayments.length} transaction${taxPayments.length === 1 ? "" : "s"} tagged as Tax`, color: totalTdsPaid > 0 ? "#1a7a45" : "#8a94a3" },
          { label: "Overdue", value: String(overdueRows.length), sub: overdueRows.length ? overdueRows.map(r => monthLabel(r.month)).join(", ") : "Nothing overdue", color: overdueRows.length ? "#9a2233" : "#1a7a45" },
        ].map((tile) => (
          <div key={tile.label} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: "14px 16px", background: "#fff" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800 }}>{tile.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tile.color, marginTop: 6 }}>{tile.value}</div>
            <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 3 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {/* TDS on salary — Section 192 */}
      <div style={card}>
        <div style={sectionTitle}>TDS on salary — Section 192 (due 7th of following month; March due 30 Apr)</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Month</th>
                <th style={{ ...th, textAlign: "right" }}>Payslips</th>
                <th style={{ ...th, textAlign: "right" }}>TDS deducted</th>
                <th style={th}>Due date</th>
                <th style={{ ...th, textAlign: "right" }}>Bank paid (that month)</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {tdsRows.map((r) => (
                <tr key={r.month}>
                  <td style={td({ fontWeight: 600, color: "#1b2331" })}>{monthLabel(r.month)}</td>
                  <td style={td({ textAlign: "right", color: "#8a94a3" })}>{r.payslipCount || "—"}</td>
                  <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.tds ? "#1b2331" : "#c3cee0", fontWeight: r.tds ? 700 : 400 })}>
                    {r.tds ? formatINR(r.tds) : "—"}
                  </td>
                  <td style={td({ color: "#5b6676", whiteSpace: "nowrap" })}>{dueDateLabel(r.due)}</td>
                  <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.paid ? "#146c3c" : "#c3cee0" })}>
                    {r.paid ? formatINR(r.paid) : "—"}
                  </td>
                  <td style={td()}>
                    {r.tds === 0 ? (
                      <span style={{ fontSize: 11, color: "#c3cee0" }}>No payslips</span>
                    ) : (
                      <StatusBadge status={r.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 12, lineHeight: 1.55 }}>
          TDS figures come from payslip deductions. Bank payment figures come from transactions tagged{" "}
          <b>Tax (GST / TDS)</b> in the banking ledger — tag them correctly there to see the match here.{" "}
          "Paid" status is heuristic (bank month = due-date month); add a remark on the bank row for
          the reference number.
        </p>
      </div>

      {/* Advance tax */}
      <div style={card}>
        <div style={sectionTitle}>Advance tax — Section 207 (company pays 100% in 4 instalments)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th}>Quarter</th>
              <th style={th}>Period covered</th>
              <th style={th}>Due date</th>
              <th style={{ ...th, textAlign: "right" }}>Cumulative target</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {advTax.map((q) => {
              // Check if any tax payment was made in the month of the due date
              const paidInMonth = taxPaidByFollowingMonth.get(q.dueDate.slice(0, 7)) ?? 0;
              const status = obligationStatus(q.dueDate, paidInMonth > 0);
              return (
                <tr key={q.quarter}>
                  <td style={td({ fontWeight: 700, color: "#1b2331" })}>{q.quarter}</td>
                  <td style={td({ color: "#5b6676" })}>{q.period}</td>
                  <td style={td({ color: "#5b6676", whiteSpace: "nowrap" })}>{dueDateLabel(q.dueDate)}</td>
                  <td style={td({ textAlign: "right", color: "#5b6676" })}>{q.cumPct}% of estimated liability</td>
                  <td style={td()}><StatusBadge status={status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 12, lineHeight: 1.55 }}>
          Advance tax applies once total tax liability exceeds ₹10,000 in a year. The system cannot compute
          your liability without knowing the full P&L — your CA should advise the instalment amounts. Once
          you pay, tag the bank row as <b>Tax (GST / TDS)</b> and add a remark like "Advance tax Q1 FY26-27".
        </p>
      </div>

      {/* GST */}
      <div style={card}>
        <div style={sectionTitle}>GST obligations</div>
        {gstRegistered ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Month</th>
                <th style={th}>GSTR-1 (outward supplies)</th>
                <th style={th}>GSTR-3B (summary return)</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const { gstr3b, gstr1 } = gstDueDates(m);
                return (
                  <tr key={m}>
                    <td style={td({ fontWeight: 600, color: "#1b2331" })}>{monthLabel(m)}</td>
                    <td style={td({ color: "#5b6676" })}>{dueDateLabel(gstr1)}</td>
                    <td style={td({ color: "#5b6676" })}>{dueDateLabel(gstr3b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", borderRadius: 8, padding: "14px 16px", color: "#7a5714", fontSize: 13 }}>
            <b>GST registration pending.</b> Once you receive your GSTIN, update{" "}
            <code>gstRegistered</code> in <code>hr/app/tax/page.tsx</code> to show the monthly filing calendar.
            GSTR-3B is due on the 20th of the month following each billing month; GSTR-1 is due on the 11th.
          </div>
        )}
      </div>

      {/* Tax payments from bank */}
      {taxPayments.length > 0 ? (
        <div style={card}>
          <div style={sectionTitle}>Tax payments from IDFC — all time ({taxPayments.length} transactions)</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                  <th style={th}>Remark</th>
                </tr>
              </thead>
              <tbody>
                {taxPayments
                  .slice()
                  .sort((a, b) => (a.date < b.date ? 1 : -1))
                  .map((t) => (
                    <tr key={t.txnId}>
                      <td style={td({ color: "#5b6676", whiteSpace: "nowrap" })}>{t.date}</td>
                      <td style={td({ color: "#1b2331" })}>{t.counterparty || t.particulars.slice(0, 60)}</td>
                      <td style={td({ textAlign: "right", fontWeight: 700, color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {formatINR(t.debit)}
                      </td>
                      <td style={td({ color: "#8a94a3", fontSize: 12 })}>{t.note || "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 10, lineHeight: 1.55 }}>
            Add a remark on each row in the{" "}
            <Link href="/banking" style={{ color: "#2f4fb0" }}>bank ledger</Link> — e.g. "TDS July 2026 challan no. XXXX" — so this
            table stays readable years later.
          </p>
        </div>
      ) : (
        <div style={{ ...card, background: "#f8fafc" }}>
          <div style={sectionTitle}>Tax payments from IDFC</div>
          <p style={{ fontSize: 13, color: "#8a94a3" }}>
            No transactions tagged <b>Tax (GST / TDS)</b> yet. When you pay TDS or advance tax from your IDFC
            account, import the statement and reclassify those rows — they will appear here.
          </p>
          <Link href="/banking" style={{ fontSize: 12.5, color: "#2f4fb0", fontWeight: 600 }}>
            Go to bank ledger &rarr;
          </Link>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 32, borderTop: "1px solid #eef2f7", paddingTop: 14, lineHeight: 1.7 }}>
        <b>How this works:</b> TDS figures come from payslip deductions. Payment status is inferred from bank
        transactions tagged <b>Tax</b> — not from TRACES or the IT portal. Always cross-check with your challan
        receipts. This page is a self-service tracker, not a filing tool.
      </div>
    </main>
  );
}
