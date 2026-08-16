import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import { BankImport } from "@/components/BankImport";
import { BankTxnRow } from "@/components/BankTxnRow";
import { categoryLabel, formatINR, summarise, type BankTxn } from "@/lib/banking";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Banking — ShieldSync HR", robots: { index: false, follow: false } };

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, background: "#fff" };
const groupTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 10 };

function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  if (!y || !mm) return m;
  return new Date(y, mm - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export default async function BankingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // The "Money by person" table links each name to the employee record, which
  // requires employees:read. A banking-only viewer would dead-end on click, so
  // render the name as plain text unless they can actually open the record.
  const { isAdmin, access } = await getViewer();
  const canOpenEmployee = isAdmin || can(access, "employees", "read");

  let all: BankTxn[] = [];
  let employees: Employee[] = [];
  let error: string | null = null;
  try {
    all = (await hrFetch<{ transactions: BankTxn[] }>("/hr/banking")).transactions ?? [];
    employees = ((await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? []).filter((e) => e.seq > 0);
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }

  const months = [...new Set(all.map((t) => t.month))].sort().reverse();
  const month = sp.month && months.includes(sp.month) ? sp.month : months[0];
  const txns = month ? all.filter((t) => t.month === month) : [];
  const s = summarise(txns);

  // Payroll reconciliation: what the ledger paid each active person this month
  // vs what their record says they're owed. This is the whole point of putting
  // banking next to HR — neither system can answer it alone.
  const paidBySeq = new Map<number, number>();
  for (const t of txns) {
    if (t.matchedEmployeeSeq && t.debit > 0) paidBySeq.set(t.matchedEmployeeSeq, (paidBySeq.get(t.matchedEmployeeSeq) ?? 0) + t.debit);
  }
  const active = employees.filter((e) => e.status !== "exited");

  // What SHOULD have left the bank for each active person this month — where a
  // payslip has actually been issued, its stated NET pay (after PF/ESI/PT/TDS)
  // is the true figure; comparing bank debits against the record's CONTRACTED
  // GROSS instead flags every payroll with a deduction as "different" even when
  // it went out exactly right. Same lookup pattern as /payslips.
  const issuedNetPay = new Map<number, number>();
  if (month) {
    await Promise.all(
      active.map(async (e) => {
        try {
          const gens = (await hrFetch<{ generated: Array<{ docId: string; docType: string; ref: string }> }>(`/hr/employees/${e.seq}/generated`)).generated ?? [];
          const hit = gens.find((g) => g.docType === "payslip" && g.ref.endsWith(` ${month}`));
          if (!hit) return;
          const g = await hrFetch<{ gen: { snapshot?: { netPay?: number } } }>(`/hr/employees/${e.seq}/generated/${hit.docId}`);
          if (typeof g.gen.snapshot?.netPay === "number") issuedNetPay.set(e.seq, g.gen.snapshot.netPay);
        } catch {
          /* best-effort — falls back to the gross estimate below */
        }
      }),
    );
  }

  // Everyone taggable, including exited staff — you still need to answer
  // "how much did we ever pay Yachna?" after she's left.
  const people = employees.map((e) => ({ seq: e.seq, name: e.name }));

  // ALL-TIME position per person, across every imported month. Money can flow
  // BOTH ways for the same person (we pay a stipend; a parent transfers a
  // course fee from their own account), so in/out/net are tracked separately —
  // a single "total" would net them off and hide both figures.
  const ledger = new Map<number, { inAmt: number; outAmt: number; count: number }>();
  for (const t of all) {
    if (!t.matchedEmployeeSeq) continue;
    const cur = ledger.get(t.matchedEmployeeSeq) ?? { inAmt: 0, outAmt: 0, count: 0 };
    cur.inAmt += t.credit;
    cur.outAmt += t.debit;
    cur.count += 1;
    ledger.set(t.matchedEmployeeSeq, cur);
  }
  const untagged = all.filter((t) => !t.matchedEmployeeSeq).length;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 24px 48px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Banking</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676" }}>Money in and out of the company account, and whether payroll actually left the bank.</p>
        </div>
        {months.length > 0 ? (
          <form method="get" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#41506a", marginBottom: 4 }} htmlFor="month">Month</label>
              <select id="month" name="month" defaultValue={month} style={{ padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 }}>
                {months.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </div>
            <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Show</button>
          </form>
        ) : null}
      </div>

      {error ? (
        <div style={{ marginTop: 18, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{error}</div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <BankImport />
      </div>

      {all.length === 0 ? (
        <div style={{ marginTop: 22, border: "1px dashed #ccd5e4", borderRadius: 12, padding: "30px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#41506a", fontWeight: 600 }}>No transactions imported yet.</p>
          <p style={{ fontSize: 12.5, color: "#8a94a3", marginTop: 5 }}>Import a statement above to see where money is coming from and going.</p>
        </div>
      ) : (
        <>
          {/* Headline numbers for the selected month */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 22 }}>
            <div style={card}>
              <div style={groupTitle}>Money in</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#146c3c" }}>{formatINR(s.totalIn)}</div>
            </div>
            <div style={card}>
              <div style={groupTitle}>Money out</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#9a2233" }}>{formatINR(s.totalOut)}</div>
            </div>
            <div style={card}>
              <div style={groupTitle}>Net this month</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.net >= 0 ? "#146c3c" : "#9a2233" }}>
                {s.net >= 0 ? "+" : "−"}{formatINR(Math.abs(s.net))}
              </div>
            </div>
            <div style={card}>
              <div style={groupTitle}>Closing balance</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#1f3a5f" }}>
                {txns.length ? formatINR(txns[0].balance) : "—"}
              </div>
              <div style={{ fontSize: 10.5, color: "#8a94a3", marginTop: 2 }}>after the latest transaction</div>
            </div>
          </div>

          {/* Where it went */}
          <section style={{ marginTop: 26 }}>
            <div style={groupTitle}>Where the money went — {monthLabel(month!)}</div>
            <div style={card}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    <th style={{ padding: "6px 8px" }}>Category</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>In</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Out</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byCategory.map((c) => (
                    <tr key={c.category} style={{ borderTop: "1px solid #eef2f7" }}>
                      <td style={{ padding: "8px", fontWeight: 600, color: "#1b2331" }}>{categoryLabel(c.category)}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: c.in ? "#146c3c" : "#c3cee0", fontVariantNumeric: "tabular-nums" }}>{c.in ? formatINR(c.in) : "—"}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: c.out ? "#9a2233" : "#c3cee0", fontVariantNumeric: "tabular-nums" }}>{c.out ? formatINR(c.out) : "—"}</td>
                      <td style={{ padding: "8px", textAlign: "right", color: "#8a94a3" }}>{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Payroll reconciliation */}
          {active.length > 0 ? (
            <section style={{ marginTop: 26 }}>
              <div style={groupTitle}>Did payroll actually go out? — {monthLabel(month!)}</div>
              <div style={card}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
                      <th style={{ padding: "6px 8px" }}>Person</th>
                      <th style={{ padding: "6px 8px" }}>Engagement</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Record says</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Bank paid</th>
                      <th style={{ padding: "6px 8px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((e) => {
                      const paid = paidBySeq.get(e.seq) ?? 0;
                      // Cash never appears in a bank statement — that's correct,
                      // not a missed payment, so it gets its own neutral status
                      // instead of being compared against the bank at all.
                      const isCash = (e.paymentMode || "").trim().toLowerCase() === "cash";
                      const netFromSlip = issuedNetPay.get(e.seq);
                      const expected = netFromSlip ?? e.grossMonthly ?? 0;
                      // A consultant has no fixed monthly figure, so "no payment"
                      // is normal rather than a discrepancy.
                      const variable = !isCash && expected === 0;
                      const ok = variable ? paid > 0 : Math.abs(paid - expected) < 1;
                      return (
                        <tr key={e.seq} style={{ borderTop: "1px solid #eef2f7" }}>
                          <td style={{ padding: "8px", fontWeight: 600, color: "#1b2331" }}>{e.name}</td>
                          <td style={{ padding: "8px", color: "#5b6676" }}>{e.employmentType}</td>
                          <td style={{ padding: "8px", textAlign: "right", color: "#5b6676", fontVariantNumeric: "tabular-nums" }}>
                            {isCash ? "paid in cash" : variable ? "per engagement" : (
                              <>
                                {formatINR(expected)}
                                {!netFromSlip ? (
                                  <span title="No payslip issued yet for this month — this is the contracted gross, before PF/ESI/PT/TDS. Issue the payslip for an exact comparison.">
                                    {" "}*
                                  </span>
                                ) : null}
                              </>
                            )}
                          </td>
                          <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, color: paid ? "#1b2331" : "#c3cee0", fontVariantNumeric: "tabular-nums" }}>
                            {isCash ? "—" : paid ? formatINR(paid) : "—"}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {isCash ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#8a94a3", background: "#f3f5f9", borderRadius: 999, padding: "3px 10px" }}>
                                Paid in cash — not expected here
                              </span>
                            ) : paid === 0 ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: variable ? "#8a94a3" : "#8a6320", background: variable ? "#f3f5f9" : "#fdf4e3", borderRadius: 999, padding: "3px 10px" }}>
                                {variable ? "Nothing this month" : "Not paid yet"}
                              </span>
                            ) : ok ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#1a7a45", background: "#e7f6ee", borderRadius: 999, padding: "3px 10px" }}>✓ Matches</span>
                            ) : (
                              <span style={{ fontSize: 11, fontWeight: 700, color: "#9a2233", background: "#fdecef", borderRadius: 999, padding: "3px 10px" }}>
                                Differs by {formatINR(Math.abs(paid - expected))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 10, lineHeight: 1.5 }}>
                  Matched by the counterparty name on the statement, or by the bank account number on their employee record — add the
                  account number to a record to make matching exact. &ldquo;Record says&rdquo; uses the issued payslip&rsquo;s net pay when
                  one exists for the month; * marks a contracted-gross estimate for a month with no payslip issued yet.
                </p>
              </div>
            </section>
          ) : null}

          {/* Per-person, all months */}
          {ledger.size > 0 ? (
            <section style={{ marginTop: 26 }}>
              <div style={groupTitle}>Money by person — all imported months</div>
              <div style={card}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
                      <th style={{ padding: "6px 8px" }}>Person</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Received from</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Paid to</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Net</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Txns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees
                      .filter((e) => ledger.has(e.seq))
                      .map((e) => {
                        const v = ledger.get(e.seq)!;
                        const net = v.inAmt - v.outAmt;
                        return (
                          <tr key={e.seq} style={{ borderTop: "1px solid #eef2f7" }}>
                            <td style={{ padding: "8px" }}>
                              {canOpenEmployee ? (
                                <Link href={`/employees/${e.seq}`} style={{ color: "#1f3a5f", fontWeight: 600, textDecoration: "none" }}>{e.name}</Link>
                              ) : (
                                <span style={{ color: "#1f3a5f", fontWeight: 600 }}>{e.name}</span>
                              )}
                              <div style={{ fontSize: 10.5, color: "#8a94a3" }}>{e.designation}</div>
                            </td>
                            <td style={{ padding: "8px", textAlign: "right", color: v.inAmt ? "#146c3c" : "#c3cee0", fontVariantNumeric: "tabular-nums" }}>{v.inAmt ? formatINR(v.inAmt) : "—"}</td>
                            <td style={{ padding: "8px", textAlign: "right", color: v.outAmt ? "#9a2233" : "#c3cee0", fontVariantNumeric: "tabular-nums" }}>{v.outAmt ? formatINR(v.outAmt) : "—"}</td>
                            <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, color: net >= 0 ? "#146c3c" : "#9a2233", fontVariantNumeric: "tabular-nums" }}>
                              {net >= 0 ? "+" : "−"}{formatINR(Math.abs(net))}
                            </td>
                            <td style={{ padding: "8px", textAlign: "right", color: "#8a94a3" }}>{v.count}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 10, lineHeight: 1.5 }}>
                  Covers every imported month, not just the one selected above. Tag a transaction to someone using the
                  <b> Person</b> column below — useful when money moves through a family member&rsquo;s account, which name
                  matching can never catch on its own.
                  {untagged > 0 ? <> <b>{untagged}</b> transaction{untagged === 1 ? " is" : "s are"} still untagged.</> : null}
                </p>
              </div>
            </section>
          ) : null}

          {/* Full ledger */}
          <section style={{ marginTop: 26 }}>
            <div style={groupTitle}>All transactions — {monthLabel(month!)}</div>
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", background: "#fafcff" }}>
                    <th style={{ padding: "8px 10px" }}>Date</th>
                    <th style={{ padding: "8px 10px" }}>Counterparty</th>
                    <th style={{ padding: "8px 10px" }}>Via</th>
                    <th style={{ padding: "8px 10px" }}>Category</th>
                    <th style={{ padding: "8px 10px" }}>Person</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Balance</th>
                    <th style={{ padding: "8px 10px" }}>Remark</th>
                    <th style={{ padding: "8px 10px" }} />
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <BankTxnRow key={t.txnId} txn={t} people={people} />
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 8 }}>
              Click a category to reclassify it (or pick <b>+ Custom…</b> to name your own). Remarks save as you click away — clear the box to delete one. Both stick: re-importing a statement won&rsquo;t overwrite them. Use × to remove a row entirely.
            </p>
          </section>
        </>
      )}

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 32, borderTop: "1px solid #eef2f7", paddingTop: 16 }}>
        <Link href="/" style={{ color: "#2f4fb0" }}>&larr; Dashboard</Link>
      </div>
    </main>
  );
}
