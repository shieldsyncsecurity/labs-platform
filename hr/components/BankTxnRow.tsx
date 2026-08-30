"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_ORDER, categoryLabel, formatINR, type BankCategory, type BankTxn } from "@/lib/banking";

// Sentinel for the "type your own" option — can never collide with a real
// category because a user can't type this value into the free-text box.
const CUSTOM_SENTINEL = "__custom__";

/** One ledger row. The category is editable inline — auto-categorisation is a
 * starting guess, and money views are only as good as their classification. */
export function BankTxnRow({ txn, people }: { txn: BankTxn; people: Array<{ seq: number; name: string }> }) {
  const router = useRouter();
  const [category, setCategory] = useState<BankCategory>(txn.category);
  const [person, setPerson] = useState<number | "">(txn.matchedEmployeeSeq ?? "");
  const [note, setNote] = useState(txn.note ?? "");
  const [savedNote, setSavedNote] = useState(txn.note ?? "");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [busy, setBusy] = useState(false);
  const [customMode, setCustomMode] = useState(false);

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

  /** Tag a row to a person. Needed because money often moves through a family
   * member's account — Yachna's father's transfer is still hers — so name
   * matching alone can never get this right. */
  async function tagPerson(next: number | "") {
    const prev = person;
    setPerson(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch(`/api/banking/${encodeURIComponent(txn.txnId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ matchedEmployeeSeq: next === "" ? null : Number(next) }),
      });
      if (!res.ok) {
        setPerson(prev);
        alert((await res.json().catch(() => ({}))).error ?? "Could not tag it.");
      } else {
        router.refresh();
      }
    } catch {
      setPerson(prev);
      alert("Could not reach the server.");
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(
      `Remove this transaction from the ledger?

${txn.date}  ${txn.counterparty ?? txn.particulars.slice(0, 40)}
` +
      `${txn.credit ? "+" : "−"}${formatINR(txn.credit || txn.debit)}

` +
      "Your month totals will change. Re-importing the statement will bring it back."
    )) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/banking/${encodeURIComponent(txn.txnId)}`, { method: "DELETE" });
      if (!res.ok) {
        alert((await res.json().catch(() => ({}))).error ?? "Could not remove it.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      alert("Could not reach the server.");
      setBusy(false);
    }
  }

  /** Saves on blur (and on Enter) — no per-row save button to hunt for. Only
   * fires when the text actually changed, so tabbing through does nothing. */
  async function saveNote() {
    const trimmed = note.trim();
    if (trimmed === savedNote) return;
    setNoteState("saving");
    try {
      const res = await fetch(`/api/banking/${encodeURIComponent(txn.txnId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (!res.ok) {
        setNote(savedNote); // never leave a value on screen that isn't stored
        setNoteState("error");
      } else {
        setSavedNote(trimmed);
        setNoteState("saved");
        setTimeout(() => setNoteState("idle"), 1600);
      }
    } catch {
      setNote(savedNote);
      setNoteState("error");
    }
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
        {customMode ? (
          <input
            autoFocus
            defaultValue={CATEGORY_ORDER.includes(category) ? "" : category}
            placeholder="Type a category…"
            maxLength={40}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setCustomMode(false);
              if (v && v !== category) change(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setCustomMode(false);
              }
            }}
            style={{ fontSize: 11.5, padding: "3px 6px", border: "1px solid #2f4fb0", borderRadius: 6, maxWidth: 150, width: "100%" }}
          />
        ) : (
          <select
            value={CATEGORY_ORDER.includes(category) ? category : CUSTOM_SENTINEL}
            disabled={busy}
            onChange={(e) => {
              if (e.target.value === CUSTOM_SENTINEL) setCustomMode(true);
              else change(e.target.value as BankCategory);
            }}
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
              <option key={c} value={c}>{categoryLabel(c)}</option>
            ))}
            {/* A category the user invented isn't in the built-in list, so it
                needs its own option or the select would show the wrong value. */}
            {!CATEGORY_ORDER.includes(category) ? (
              <option value={CUSTOM_SENTINEL}>{category}</option>
            ) : null}
            <option value={CUSTOM_SENTINEL}>+ Custom…</option>
          </select>
        )}
      </td>
      <td style={{ padding: "8px 10px" }}>
        <select
          value={person}
          disabled={busy}
          onChange={(e) => tagPerson(e.target.value === "" ? "" : Number(e.target.value))}
          style={{
            fontSize: 11.5, padding: "3px 6px", border: "1px solid #d4dbe8", borderRadius: 6,
            background: person === "" ? "#fff" : "#eef6ff", color: person === "" ? "#8a94a3" : "#1b2331", maxWidth: 140,
          }}
        >
          <option value="">— not tagged —</option>
          {people.map((p) => (
            <option key={p.seq} value={p.seq}>{p.name}</option>
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
      <td style={{ padding: "8px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNote(savedNote);
                e.currentTarget.blur();
              }
            }}
            placeholder="Add remark…"
            maxLength={200}
            style={{
              width: "100%",
              minWidth: 130,
              fontSize: 11.5,
              padding: "4px 7px",
              border: `1px solid ${noteState === "error" ? "#f6c6ce" : "#e2e8f2"}`,
              borderRadius: 6,
              background: noteState === "error" ? "#fdecef" : savedNote ? "#fff" : "#fafcff",
              color: "#1b2331",
            }}
          />
          <span style={{ fontSize: 10.5, whiteSpace: "nowrap", color: noteState === "error" ? "#9a2233" : "#1a7a45", minWidth: 12 }}>
            {noteState === "saving" ? "…" : noteState === "saved" ? "✓" : noteState === "error" ? "!" : ""}
          </span>
        </div>
      </td>
      <td style={{ padding: "8px 10px", textAlign: "right" }}>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="Remove this transaction from the ledger"
          onMouseOver={(e) => { e.currentTarget.style.color = "#9a2233"; }}
          onMouseOut={(e) => { e.currentTarget.style.color = "#7a8699"; }}
          // Legible slate at rest (was near-invisible #c3cee0 on white for a
          // destructive control), strengthening to danger red on hover.
          style={{ background: "none", border: "none", color: "#7a8699", fontSize: 16, fontWeight: 700, lineHeight: 1, cursor: busy ? "default" : "pointer", padding: "2px 4px" }}
        >
          ×
        </button>
      </td>
    </tr>
  );
}
