"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Invoice, InvoiceStatus } from "@/lib/invoice";

async function copyClientLink(invId: string): Promise<string | null> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(invId)}/link`, { method: "POST" });
  if (!res.ok) return null;
  const { url } = await res.json();
  try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
  return url;
}

const TRANSITIONS: Record<InvoiceStatus, { label: string; next: InvoiceStatus }[]> = {
  draft: [{ label: "Mark as sent", next: "sent" }],
  sent: [
    { label: "Mark as paid", next: "paid" },
    { label: "Back to draft", next: "draft" },
  ],
  paid: [{ label: "Revert to sent", next: "sent" }],
  overdue: [{ label: "Mark as paid", next: "paid" }],
};

export function InvoiceActions({ invoice, liveStatus }: { invoice: Invoice; liveStatus: InvoiceStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [showPaidModal, setShowPaidModal] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  async function transition(next: InvoiceStatus, extraFields?: Record<string, unknown>) {
    setBusy(true);
    try {
      // Moving off "paid" (e.g. Revert to sent) must clear the payment stamp,
      // else the invoice still infers as paid because paidDate is set.
      const clearPaid = next !== "paid" ? { paidDate: null, paidAmount: null } : {};
      await fetch(`/api/invoices/${encodeURIComponent(invoice.invId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, ...clearPaid, ...extraFields }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvoice() {
    setBusy(true);
    try {
      await fetch(`/api/invoices/${encodeURIComponent(invoice.invId)}`, { method: "DELETE" });
      router.push("/invoices");
    } finally {
      setBusy(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 700,
    padding: "8px 14px",
    borderRadius: 7,
    border: "1px solid #d4dbe8",
    cursor: "pointer",
    background: "#fff",
    color: "#1b2331",
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {/* Status transitions */}
        {(TRANSITIONS[liveStatus] ?? []).map((t) => (
          <button key={t.next} disabled={busy} onClick={() => {
            if (t.next === "paid") { setShowPaidModal(true); return; }
            transition(t.next);
          }} style={{ ...btnStyle, background: t.next === "paid" ? "#1a7a45" : "#fff", color: t.next === "paid" ? "#fff" : "#1b2331", border: t.next === "paid" ? "none" : "1px solid #d4dbe8" }}>
            {t.label}
          </button>
        ))}
        {/* Share client link */}
        <button disabled={busy} onClick={async () => {
          setBusy(true);
          const url = await copyClientLink(invoice.invId);
          setBusy(false);
          if (url) { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 3000); }
        }} style={{ ...btnStyle, background: linkCopied ? "#dcfce7" : "#fff", color: linkCopied ? "#15803d" : "#1b2331" }}>
          {linkCopied ? "✓ Link copied" : "Share with client"}
        </button>
        {/* Print */}
        <a href={`/invoices/${invoice.invId}/view`} target="_blank" rel="noopener"
          style={{ ...btnStyle, textDecoration: "none", color: "#1b2331" }}>
          Print / PDF
        </a>
        {/* Delete */}
        <button onClick={() => setShowDelete(true)} disabled={busy}
          style={{ ...btnStyle, color: "#9a2233", borderColor: "#f6c6ce" }}>
          Delete
        </button>
      </div>

      {/* Mark paid modal */}
      {showPaidModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 340, fontFamily: "Arial, sans-serif" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1f3a5f", marginBottom: 16 }}>Mark as paid</div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#41506a", marginBottom: 4 }}>Payment date</label>
            <input type="date" value={paidDate} onChange={e => setPaidDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 6, marginBottom: 18 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={async () => {
                await transition("paid", { paidDate, paidAmount: invoice.totalAmount });
                setShowPaidModal(false);
              }} style={{ flex: 1, background: "#1a7a45", color: "#fff", border: "none", borderRadius: 7, padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Confirm paid
              </button>
              <button onClick={() => setShowPaidModal(false)} style={{ flex: 1, background: "#f1f3f7", border: "none", borderRadius: 7, padding: "9px", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {showDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 340, fontFamily: "Arial, sans-serif" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#9a2233", marginBottom: 10 }}>Delete {invoice.invId}?</div>
            <div style={{ fontSize: 13, color: "#5b6676", marginBottom: 20 }}>This cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={deleteInvoice}
                style={{ flex: 1, background: "#9a2233", color: "#fff", border: "none", borderRadius: 7, padding: "9px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Delete
              </button>
              <button onClick={() => setShowDelete(false)}
                style={{ flex: 1, background: "#f1f3f7", border: "none", borderRadius: 7, padding: "9px", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
