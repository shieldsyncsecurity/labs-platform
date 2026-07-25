"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_LABEL, CATEGORY_ORDER, formatINR, type BankCategory, type BankTxn } from "@/lib/banking";

/** One ledger row. The category is editable inline — auto-categorisation is a
 * starting guess, and money views are only as good as their classification. */
export function BankTxnRow({ txn }: { txn: BankTxn }) {
  const router = useRouter();
  const [category, setCategory] = useState<BankCategory>(txn.category);
  const [busy, setBusy] = useState(false);

  async function change(next: BankCategory) {
    const prev = category;
    setCategory(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch(`/api/banking/${encodeURIComponent(txn.txnId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: next }),
      });
      if (!res.ok) {
        setCategory(prev); // roll back so the UI never shows a save that didn't happen
        alert((await res.json().catch(() => ({}))).error ?? "Could not update.");
      } else {
        router.refresh();
      }
    } catch {
      setCategory(prev);
      alert("Could not reach the server.");
    }
    setBusy(false);
  }

  const isCredit = txn.credit > 0;

  return (
    <tr style={{ borderTop: "1px solid #eef2f7" }}>
      <td style={{ padding: "8px 10px", color: "#5b6676", whiteSpace: "nowrap" }}>{txn.date}</td>
      <td style={{ padding: "8px 10px", color: "#1b2331" }}>
        <div style={{ fontWeight: 600 }}>{txn.counterparty ?? "—"}</div>
        <div style={{ fontSize: 10.5, color: "#8a94a3", fontFamily: "monospace" }} title={txn.particulars}>
          {txn.particulars.length > 52 ? txn.particulars.slice(0, 52) + "…" : txn.particulars}
        </div>
      </td>
      <td style={{ padding: "8px 10px", color: "#8a94a3", whiteSpace: "nowrap" }}>{txn.method ?? "—"}</td>
      <td style={{ padding: "8px 10px" }}>
        <select
          value={category}
          disabled={busy}
          onChange={(e) => change(e.target.value as BankCategory)}
          style={{
            fontSize: 11.5,
            padding: "3px 6px",
            border: "1px solid #d4dbe8",
            borderRadius: 6,
            background: category === "other" ? "#fdf4e3" : "#fff",
            color: "#1b2331",
            maxWidth: 150,
          }}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: isCredit ? "#146c3c" : "#9a2233" }}>
        {isCredit ? "+" : "−"}
        {formatINR(isCredit ? txn.credit : txn.debit)}
      </td>
      <td style={{ padding: "8px 10px", textAlign: "right", color: "#5b6676", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {formatINR(txn.balance)}
      </td>
    </tr>
  );
}
