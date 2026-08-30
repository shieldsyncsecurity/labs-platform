"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { computeGst, formatAmount, type LineItem } from "@/lib/invoice";

const field: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 6, fontFamily: "inherit" };
const label: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };

function emptyLine(): LineItem { return { description: "", qty: 1, rate: 0, amount: 0 }; }

const GST_RATE_OPTIONS = [0, 5, 12, 18, 28];

/** New-invoice form. Whether the GST row appears (and its default rate) comes
 * from the in-app GST setting, passed in by the server page — no hardcoded
 * flag, so switching GST on is a portal setting, not a code change. */
export function NewInvoiceForm({ gstRegistered, defaultRate }: { gstRegistered: boolean; defaultRate: number }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const netDue = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientGstin, setClientGstin] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [description, setDescription] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(netDue);
  const [status, setStatus] = useState<"draft" | "sent">("draft");
  const [gstRate, setGstRate] = useState(gstRegistered ? defaultRate : 0);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setLines((prev) => {
      const next = prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l);
      if (field === "qty" || field === "rate") {
        next[i].amount = Math.round(next[i].qty * next[i].rate * 100) / 100;
      }
      if (field === "amount") next[i].amount = Number(value);
      return next;
    });
  }

  const subtotal = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const { gstAmount, totalAmount } = computeGst(subtotal, gstRate);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName, clientEmail, clientGstin, clientAddress,
          description: description || lines[0]?.description || "Professional services",
          lineItems: lines.filter(l => l.description.trim()),
          amount: subtotal, gstRate, gstAmount, totalAmount,
          issueDate, dueDate, status, notes,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? `HTTP ${res.status}`); }
      const { invoice } = await res.json();
      router.push(`/invoices/${invoice.invId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create invoice.");
      setSaving(false);
    }
  }

  const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: "20px 22px", background: "#fff", marginTop: 20 };
  const sectionTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase" as const, letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 14 };
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/invoices" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Invoices</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 8 }}>New invoice</h1>

      <form onSubmit={submit}>
        {/* Client */}
        <div style={card}>
          <div style={sectionTitle}>Client</div>
          <div style={grid2}>
            <div>
              <label style={label}>Client / organisation name *</label>
              <input style={field} value={clientName} onChange={e => setClientName(e.target.value)} required placeholder="Acme Corp" />
            </div>
            <div>
              <label style={label}>Billing email</label>
              <input style={field} type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="billing@client.com" />
            </div>
            <div>
              <label style={label}>Client GSTIN (if registered)</label>
              <input style={field} value={clientGstin} onChange={e => setClientGstin(e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" />
            </div>
            <div>
              <label style={label}>Billing address</label>
              <input style={field} value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="City, State, India" />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div style={card}>
          <div style={sectionTitle}>Services / line items</div>
          <div>
            <label style={label}>Invoice summary (top-level)</label>
            <input style={{ ...field, marginBottom: 14 }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Cloud Security Assessment — Q3 2026" />
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontSize: 11, color: "#8a94a3", padding: "0 0 6px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>Description</th>
                <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 6px 8px", fontWeight: 800, width: 60 }}>Qty</th>
                <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 6px 8px", fontWeight: 800, width: 110 }}>Rate (₹)</th>
                <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 6px 8px", fontWeight: 800, width: 120 }}>Amount (₹)</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td style={{ paddingBottom: 8 }}>
                    <input style={{ ...field, fontSize: 12.5 }} value={line.description}
                      onChange={e => updateLine(i, "description", e.target.value)} placeholder="Service description" />
                  </td>
                  <td style={{ paddingBottom: 8, paddingLeft: 8 }}>
                    <input style={{ ...field, textAlign: "right", fontSize: 12.5 }} type="number" min={1} value={line.qty}
                      onChange={e => updateLine(i, "qty", Number(e.target.value))} />
                  </td>
                  <td style={{ paddingBottom: 8, paddingLeft: 8 }}>
                    <input style={{ ...field, textAlign: "right", fontSize: 12.5 }} type="number" min={0} step={0.01} value={line.rate}
                      onChange={e => updateLine(i, "rate", Number(e.target.value))} />
                  </td>
                  <td style={{ paddingBottom: 8, paddingLeft: 8, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {formatAmount(line.amount)}
                  </td>
                  <td style={{ paddingBottom: 8, paddingLeft: 8 }}>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines(l => l.filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#9a2233", fontSize: 16 }}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button type="button" onClick={() => setLines(l => [...l, emptyLine()])}
            style={{ fontSize: 12.5, color: "#2f4fb0", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
            + Add line
          </button>

          {/* Totals */}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <table style={{ width: 260, fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 0", color: "#5b6676" }}>Subtotal</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatAmount(subtotal)}</td>
                </tr>
                {gstRegistered && (
                  <tr>
                    <td style={{ padding: "4px 0", color: "#5b6676" }}>
                      GST rate:
                      <select value={gstRate} onChange={e => setGstRate(Number(e.target.value))}
                        style={{ marginLeft: 8, fontSize: 12, padding: "2px 4px", border: "1px solid #d4dbe8", borderRadius: 4 }}>
                        {GST_RATE_OPTIONS.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatAmount(gstAmount)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ padding: "8px 0 4px", fontWeight: 800, color: "#1f3a5f", borderTop: "2px solid #1f3a5f" }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 800, color: "#1f3a5f", fontSize: 15, borderTop: "2px solid #1f3a5f", fontVariantNumeric: "tabular-nums" }}>
                    {formatAmount(totalAmount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Dates & status */}
        <div style={card}>
          <div style={sectionTitle}>Dates & status</div>
          <div style={grid2}>
            <div>
              <label style={label}>Issue date *</label>
              <input style={field} type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} required />
            </div>
            <div>
              <label style={label}>Due date</label>
              <input style={field} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
            <div>
              <label style={label}>Initial status</label>
              <select style={field} value={status} onChange={e => setStatus(e.target.value as "draft" | "sent")}>
                <option value="draft">Draft</option>
                <option value="sent">Mark as sent</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={card}>
          <div style={sectionTitle}>Notes (optional)</div>
          <textarea style={{ ...field, minHeight: 80, resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Payment terms, project ref, PO number..." />
        </div>

        {error && (
          <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#9a2233", marginTop: 14 }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" disabled={saving || !clientName.trim() || subtotal <= 0}
            style={{ background: "#1f3a5f", color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 24px", borderRadius: 8, border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? .7 : 1 }}>
            {saving ? "Creating…" : "Create invoice"}
          </button>
          <Link href="/invoices" style={{ fontSize: 13, color: "#5b6676", padding: "10px 16px", textDecoration: "none" }}>Cancel</Link>
          {subtotal <= 0 && (
            <span style={{ fontSize: 12, color: "#8a94a3" }}>Add at least one line with an amount.</span>
          )}
        </div>
      </form>
    </main>
  );
}
