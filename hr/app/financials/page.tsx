import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { requireAdminPage } from "@/lib/server/hr-access";
import { categoryLabel, formatINR, type BankTxn, type BankCategory } from "@/lib/banking";
import { currentFY, fyMonths, monthLabel } from "@/lib/tax";

export const dynamic = "force-dynamic";
export const metadata = { title: "Financials — ShieldSync HR", robots: { index: false, follow: false } };

// Income categories: money coming IN to the account
const INC: BankCategory[] = ["revenue", "owner-funds", "loan"];
// Expense categories: money going OUT
const EXP: BankCategory[] = ["salary", "professional-fee", "vendor", "tax", "bank-charge"];
// transfer / other — tracked but placed in "Other" row

type MonthSummary = {
  incByCat: Record<string, number>;
  expByCat: Record<string, number>;
  totalIn: number;
  totalOut: number;
  otherIn: number;
  otherOut: number;
  net: number;
};

function buildSummary(txns: BankTxn[], months: string[]): Map<string, MonthSummary> {
  const map = new Map<string, MonthSummary>();
  for (const m of months) {
    map.set(m, { incByCat: {}, expByCat: {}, totalIn: 0, totalOut: 0, otherIn: 0, otherOut: 0, net: 0 });
  }
  for (const t of txns) {
    const s = map.get(t.month);
    if (!s) continue;
    if (t.credit > 0) {
      if (INC.includes(t.category as BankCategory)) {
        s.incByCat[t.category] = (s.incByCat[t.category] ?? 0) + t.credit;
      } else {
        s.otherIn += t.credit;
      }
      s.totalIn += t.credit;
    }
    if (t.debit > 0) {
      if (EXP.includes(t.category as BankCategory)) {
        s.expByCat[t.category] = (s.expByCat[t.category] ?? 0) + t.debit;
      } else {
        s.otherOut += t.debit;
      }
      s.totalOut += t.debit;
    }
    s.net = s.totalIn - s.totalOut;
  }
  return map;
}

const card: React.CSSProperties = {
  border: "1px solid #e2e8f2",
  borderRadius: 10,
  padding: "18px 20px",
  background: "#fff",
  marginTop: 20,
};
const th: React.CSSProperties = {
  padding: "7px 10px",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".06em",
  color: "#8a94a3",
  textAlign: "left" as const,
  fontWeight: 800,
  whiteSpace: "nowrap",
};
const thr: React.CSSProperties = { ...th, textAlign: "right" as const };
function td(extra?: React.CSSProperties): React.CSSProperties {
  return { padding: "9px 10px", fontSize: 12.5, borderTop: "1px solid #eef2f7", ...extra };
}

export default async function FinancialsPage() {
  await requireAdminPage();

  const fy = currentFY();
  const fyMonthKeys = fyMonths(fy.start); // 12 months April → March

  let all: BankTxn[] = [];
  let loadFailed = false;
  try {
    all = (await hrFetch<{ transactions: BankTxn[] }>("/hr/banking")).transactions ?? [];
  } catch {
    // Don't let a failed load masquerade as real ₹0 figures / an "import a
    // statement" empty state — flag it so the page can say the numbers are
    // unreliable (matches the banner pattern in access/audit).
    loadFailed = true;
  }

  // Current FY transactions only (for the FY table)
  const fyTxns = all.filter((t) => fyMonthKeys.includes(t.month));
  const byMonth = buildSummary(fyTxns, fyMonthKeys);

  // FY totals
  let fyIn = 0, fyOut = 0;
  let fyCatIn: Record<string, number> = {};
  let fyCatOut: Record<string, number> = {};
  for (const s of byMonth.values()) {
    fyIn += s.totalIn;
    fyOut += s.totalOut;
    for (const [k, v] of Object.entries(s.incByCat)) fyCatIn[k] = (fyCatIn[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.expByCat)) fyCatOut[k] = (fyCatOut[k] ?? 0) + v;
  }
  const fyNet = fyIn - fyOut;

  // All-time across all imported months
  const allMonths = [...new Set(all.map((t) => t.month))].sort();
  const allByMonth = buildSummary(all, allMonths);

  // Running net position across all time
  let runningNet = 0;
  const runningByMonth = allMonths.map((m) => {
    const s = allByMonth.get(m)!;
    runningNet += s.net;
    return { month: m, net: s.net, running: runningNet };
  });

  // Which expense/income categories have any data in FY (to avoid empty columns)
  const activeInc = INC.filter((c) => fyTxns.some((t) => t.category === c && t.credit > 0));
  const activeExp = EXP.filter((c) => fyTxns.some((t) => t.category === c && t.debit > 0));
  const hasOtherIn = fyTxns.some((t) => !INC.includes(t.category as BankCategory) && t.credit > 0);
  const hasOtherOut = fyTxns.some((t) => !EXP.includes(t.category as BankCategory) && t.debit > 0);

  const months = fyMonthKeys.filter((m) => {
    const s = byMonth.get(m)!;
    return s.totalIn > 0 || s.totalOut > 0;
  });

  const tile = (label: string, value: string, sub: string, color: string): React.ReactNode => (
    <div key={label} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: "14px 16px", background: "#fff" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 6 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 3 }}>{sub}</div>
    </div>
  );

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Home</Link>

      {loadFailed ? (
        <div style={{ marginTop: 12, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "10px 12px" }}>
          Couldn&rsquo;t load bank data just now — the figures below are <b>not reliable</b> (they may read ₹0 where data actually exists). Refresh in a moment.
        </div>
      ) : null}

      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Financials</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676", marginTop: 4 }}>
            {fy.label} · Derived from IDFC bank transactions. Categories set in the{" "}
            <Link href="/banking" style={{ color: "#2f4fb0" }}>bank ledger</Link>.
          </p>
        </div>
        <Link href="/tax" style={{ fontSize: 12.5, color: "#2f4fb0", fontWeight: 600 }}>
          Tax obligations &rarr;
        </Link>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 20 }}>
        {tile(`Revenue ${fy.label}`, formatINR(fyCatIn["revenue"] ?? 0), "Client payments in", "#1f3a5f")}
        {tile("Total income", formatINR(fyIn), "All credits this FY", "#1a7a45")}
        {tile("Total expenses", formatINR(fyOut), "All debits this FY", "#9a2233")}
        {tile("Net position", formatINR(fyNet), fyNet >= 0 ? "Surplus" : "Deficit", fyNet >= 0 ? "#1a7a45" : "#9a2233")}
      </div>

      {/* Month-by-month P&L table */}
      {months.length === 0 ? (
        <div style={{ ...card, background: "#f8fafc", textAlign: "center", padding: "32px 20px" }}>
          <div style={{ fontSize: 14, color: "#8a94a3" }}>No bank transactions for {fy.label} yet.</div>
          <Link href="/banking" style={{ fontSize: 13, color: "#2f4fb0", fontWeight: 600, display: "inline-block", marginTop: 10 }}>
            Import a statement &rarr;
          </Link>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 }}>
            Monthly P&amp;L — {fy.label}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={th}>Month</th>
                  {/* Income columns */}
                  {activeInc.map((c) => (
                    <th key={c} style={thr}>{categoryLabel(c)}</th>
                  ))}
                  {hasOtherIn && <th style={thr}>Other in</th>}
                  <th style={{ ...thr, color: "#1a7a45" }}>Total in</th>
                  {/* Expense columns */}
                  {activeExp.map((c) => (
                    <th key={c} style={thr}>{categoryLabel(c)}</th>
                  ))}
                  {hasOtherOut && <th style={thr}>Other out</th>}
                  <th style={{ ...thr, color: "#9a2233" }}>Total out</th>
                  <th style={{ ...thr, color: "#1f3a5f" }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const s = byMonth.get(m)!;
                  const net = s.net;
                  return (
                    <tr key={m}>
                      <td style={td({ fontWeight: 700, color: "#1b2331", whiteSpace: "nowrap" })}>{monthLabel(m)}</td>
                      {activeInc.map((c) => (
                        <td key={c} style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.incByCat[c] ? "#1a7a45" : "#c3cee0" })}>
                          {s.incByCat[c] ? formatINR(s.incByCat[c]) : "—"}
                        </td>
                      ))}
                      {hasOtherIn && (
                        <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.otherIn ? "#5b6676" : "#c3cee0" })}>
                          {s.otherIn ? formatINR(s.otherIn) : "—"}
                        </td>
                      )}
                      <td style={td({ textAlign: "right", fontWeight: 700, color: "#1a7a45", fontVariantNumeric: "tabular-nums" })}>
                        {s.totalIn ? formatINR(s.totalIn) : "—"}
                      </td>
                      {activeExp.map((c) => (
                        <td key={c} style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.expByCat[c] ? "#5b6676" : "#c3cee0" })}>
                          {s.expByCat[c] ? formatINR(s.expByCat[c]) : "—"}
                        </td>
                      ))}
                      {hasOtherOut && (
                        <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: s.otherOut ? "#5b6676" : "#c3cee0" })}>
                          {s.otherOut ? formatINR(s.otherOut) : "—"}
                        </td>
                      )}
                      <td style={td({ textAlign: "right", fontWeight: 700, color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {s.totalOut ? formatINR(s.totalOut) : "—"}
                      </td>
                      <td style={td({ textAlign: "right", fontWeight: 800, color: net >= 0 ? "#1a7a45" : "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {net >= 0 ? "+" : ""}{formatINR(net)}
                      </td>
                    </tr>
                  );
                })}
                {/* FY Totals row */}
                <tr style={{ background: "#f0f4fa" }}>
                  <td style={td({ fontWeight: 800, color: "#1f3a5f" })}>FY Total</td>
                  {activeInc.map((c) => (
                    <td key={c} style={td({ textAlign: "right", fontWeight: 700, color: "#1a7a45", fontVariantNumeric: "tabular-nums" })}>
                      {fyCatIn[c] ? formatINR(fyCatIn[c]) : "—"}
                    </td>
                  ))}
                  {hasOtherIn && <td style={td({ textAlign: "right", fontWeight: 700, color: "#5b6676" })}>{formatINR(fyTxns.filter(t => !INC.includes(t.category as BankCategory) && t.credit > 0).reduce((s, t) => s + t.credit, 0))}</td>}
                  <td style={td({ textAlign: "right", fontWeight: 800, color: "#1a7a45", fontVariantNumeric: "tabular-nums" })}>{formatINR(fyIn)}</td>
                  {activeExp.map((c) => (
                    <td key={c} style={td({ textAlign: "right", fontWeight: 700, color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                      {fyCatOut[c] ? formatINR(fyCatOut[c]) : "—"}
                    </td>
                  ))}
                  {hasOtherOut && <td style={td({ textAlign: "right", fontWeight: 700, color: "#5b6676" })}>{formatINR(fyTxns.filter(t => !EXP.includes(t.category as BankCategory) && t.debit > 0).reduce((s, t) => s + t.debit, 0))}</td>}
                  <td style={td({ textAlign: "right", fontWeight: 800, color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>{formatINR(fyOut)}</td>
                  <td style={td({ textAlign: "right", fontWeight: 800, color: fyNet >= 0 ? "#1a7a45" : "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                    {fyNet >= 0 ? "+" : ""}{formatINR(fyNet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Running net position — all imported months */}
      {runningByMonth.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 }}>
            Running net position — all imported months
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={th}>Month</th>
                  <th style={thr}>Total in</th>
                  <th style={thr}>Total out</th>
                  <th style={thr}>Month net</th>
                  <th style={thr}>Cumulative net</th>
                </tr>
              </thead>
              <tbody>
                {runningByMonth.map(({ month: m, net, running }) => {
                  const s = allByMonth.get(m)!;
                  return (
                    <tr key={m}>
                      <td style={td({ fontWeight: 600, color: "#1b2331", whiteSpace: "nowrap" })}>{monthLabel(m)}</td>
                      <td style={td({ textAlign: "right", color: "#1a7a45", fontVariantNumeric: "tabular-nums" })}>
                        {s.totalIn ? formatINR(s.totalIn) : "—"}
                      </td>
                      <td style={td({ textAlign: "right", color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {s.totalOut ? formatINR(s.totalOut) : "—"}
                      </td>
                      <td style={td({ textAlign: "right", fontWeight: 700, color: net >= 0 ? "#1a7a45" : "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {net >= 0 ? "+" : ""}{formatINR(net)}
                      </td>
                      <td style={td({ textAlign: "right", fontWeight: 800, color: running >= 0 ? "#1f3a5f" : "#9a2233", fontVariantNumeric: "tabular-nums" })}>
                        {running >= 0 ? "+" : ""}{formatINR(running)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 10, lineHeight: 1.55 }}>
            Cumulative net is money-in minus money-out across every imported bank statement.
            It does not account for cash before you started importing statements.
          </p>
        </div>
      )}

      {/* Category breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={card}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 }}>
            Income breakdown — {fy.label}
          </div>
          {fyIn === 0 ? (
            <p style={{ fontSize: 13, color: "#8a94a3" }}>No credits imported for this FY yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {Object.entries(fyCatIn)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <tr key={cat}>
                      <td style={td({ color: "#1b2331" })}>{categoryLabel(cat as BankCategory)}</td>
                      <td style={td({ textAlign: "right", fontWeight: 700, color: "#1a7a45", fontVariantNumeric: "tabular-nums" })}>{formatINR(amt)}</td>
                      <td style={td({ textAlign: "right", color: "#8a94a3", width: 48 })}>{Math.round((amt / fyIn) * 100)}%</td>
                    </tr>
                  ))}
                {hasOtherIn && (
                  <tr>
                    <td style={td({ color: "#8a94a3" })}>Other (transfer / uncategorised)</td>
                    <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#8a94a3" })}>
                      {formatINR(fyTxns.filter(t => !INC.includes(t.category as BankCategory) && t.credit > 0).reduce((s, t) => s + t.credit, 0))}
                    </td>
                    <td style={td({ textAlign: "right", color: "#8a94a3" })}>
                      {Math.round((fyTxns.filter(t => !INC.includes(t.category as BankCategory) && t.credit > 0).reduce((s, t) => s + t.credit, 0) / fyIn) * 100)}%
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 }}>
            Expense breakdown — {fy.label}
          </div>
          {fyOut === 0 ? (
            <p style={{ fontSize: 13, color: "#8a94a3" }}>No debits imported for this FY yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {Object.entries(fyCatOut)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, amt]) => (
                    <tr key={cat}>
                      <td style={td({ color: "#1b2331" })}>{categoryLabel(cat as BankCategory)}</td>
                      <td style={td({ textAlign: "right", fontWeight: 700, color: "#9a2233", fontVariantNumeric: "tabular-nums" })}>{formatINR(amt)}</td>
                      <td style={td({ textAlign: "right", color: "#8a94a3", width: 48 })}>{Math.round((amt / fyOut) * 100)}%</td>
                    </tr>
                  ))}
                {hasOtherOut && (
                  <tr>
                    <td style={td({ color: "#8a94a3" })}>Other (transfer / uncategorised)</td>
                    <td style={td({ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#8a94a3" })}>
                      {formatINR(fyTxns.filter(t => !EXP.includes(t.category as BankCategory) && t.debit > 0).reduce((s, t) => s + t.debit, 0))}
                    </td>
                    <td style={td({ textAlign: "right", color: "#8a94a3" })}>
                      {Math.round((fyTxns.filter(t => !EXP.includes(t.category as BankCategory) && t.debit > 0).reduce((s, t) => s + t.debit, 0) / fyOut) * 100)}%
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 32, borderTop: "1px solid #eef2f7", paddingTop: 14, lineHeight: 1.7 }}>
        <b>How this works:</b> Figures come from categorised IDFC bank transactions — change the category on any row in the{" "}
        <Link href="/banking" style={{ color: "#2f4fb0" }}>bank ledger</Link> and this page updates on next load.
        This is a cash-basis view (money when it moves, not when invoiced). Share with your CA for monthly reporting.
      </div>
    </main>
  );
}
