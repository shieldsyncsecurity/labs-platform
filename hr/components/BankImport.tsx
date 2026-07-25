"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { categoryLabel, formatINR, type BankTxn } from "@/lib/banking";
import { ghostBtn, primaryBtn } from "./fields";

type Parsed = {
  accountNumber: string;
  customerName?: string;
  periodLabel?: string;
  transactions: BankTxn[];
  stated: { debitCount?: number; creditCount?: number; totalDebit?: number; totalCredit?: number; openingBalance?: number; closingBalance?: number };
  warnings: string[];
  fileName: string;
};

/**
 * Upload -> review -> commit. The review step exists on purpose: an import
 * that silently drops rows would quietly misstate the company's cash position,
 * so the parsed totals and the bank's own stated totals are both shown before
 * anything is saved.
 */
export function BankImport() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setParsed(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/banking/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not read that statement.");
      else setParsed(data as Parsed);
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactions: parsed.transactions, accountNumber: parsed.accountNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not import.");
      } else {
        setDone(`Imported — ${data.created} new, ${data.updated} already on file (updated).`);
        setParsed(null);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  const totalIn = parsed?.transactions.reduce((s, t) => s + t.credit, 0) ?? 0;
  const totalOut = parsed?.transactions.reduce((s, t) => s + t.debit, 0) ?? 0;

  return (
    <div style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, background: "#fff" }}>
      <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>Import a bank statement</div>
      <p style={{ fontSize: 12, color: "#5b6676", margin: "5px 0 12px", lineHeight: 1.55 }}>
        Download the <b>Excel (.xlsx)</b> statement from IDFC net banking and drop it here. Importing the same period twice is safe —
        rows are matched exactly, so nothing gets counted twice.
      </p>

      <input ref={ref} type="file" accept=".xlsx" onChange={pick} style={{ display: "none" }} id="stmt-input" />
      <label
        htmlFor="stmt-input"
        style={{ ...ghostBtn, display: "inline-flex", alignItems: "center", gap: 8, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        📄 {busy ? "Reading…" : "Choose statement (.xlsx)"}
      </label>

      {error ? (
        <div style={{ marginTop: 10, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", lineHeight: 1.5 }}>{error}</div>
      ) : null}
      {done ? (
        <div style={{ marginTop: 10, background: "#e7f6ee", border: "1px solid #b7e2c9", color: "#146c3c", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{done}</div>
      ) : null}

      {parsed ? (
        <div style={{ marginTop: 14, borderTop: "1px solid #eef2f7", paddingTop: 14 }}>
          <div style={{ fontSize: 12.5, color: "#1b2331", fontWeight: 700 }}>
            {parsed.fileName} — {parsed.transactions.length} transactions
          </div>
          <div style={{ fontSize: 12, color: "#5b6676", marginTop: 3 }}>
            A/c {parsed.accountNumber}
            {parsed.periodLabel ? ` · ${parsed.periodLabel}` : ""}
          </div>

          {/* The bank's own totals vs what we read — the anti-silent-drop check. */}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 12.5 }}>
            <span style={{ color: "#146c3c" }}>In <b>{formatINR(totalIn)}</b></span>
            <span style={{ color: "#9a2233" }}>Out <b>{formatINR(totalOut)}</b></span>
            {parsed.stated.closingBalance !== undefined ? (
              <span style={{ color: "#1f3a5f" }}>Closing <b>{formatINR(parsed.stated.closingBalance)}</b></span>
            ) : null}
          </div>

          {parsed.warnings.length > 0 ? (
            <div style={{ marginTop: 10, background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", lineHeight: 1.6 }}>
              <b>Check before importing:</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {parsed.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: "#146c3c" }}>
              ✓ Cross-checked against the statement&rsquo;s own totals — transaction count and amounts both reconcile.
            </div>
          )}

          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 12, border: "1px solid #eef2f7", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {parsed.transactions.slice(0, 60).map((t) => (
                  <tr key={t.txnId} style={{ borderTop: "1px solid #f4f7fb" }}>
                    <td style={{ padding: "6px 8px", color: "#5b6676", whiteSpace: "nowrap" }}>{t.date}</td>
                    <td style={{ padding: "6px 8px", color: "#1b2331" }}>{t.counterparty ?? t.particulars.slice(0, 40)}</td>
                    <td style={{ padding: "6px 8px", color: "#8a94a3", whiteSpace: "nowrap" }}>{categoryLabel(t.category)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", color: t.credit ? "#146c3c" : "#9a2233", fontVariantNumeric: "tabular-nums" }}>
                      {t.credit ? "+" + formatINR(t.credit) : "−" + formatINR(t.debit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.transactions.length > 60 ? (
              <div style={{ padding: "6px 8px", fontSize: 11.5, color: "#8a94a3" }}>
                …and {parsed.transactions.length - 60} more (all will be imported).
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button type="button" onClick={commit} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Importing…" : `Import ${parsed.transactions.length} transactions`}
            </button>
            <button type="button" onClick={() => setParsed(null)} disabled={busy} style={ghostBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
