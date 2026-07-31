import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch } from "@/lib/server/hr-engine";
import { requireAdminPage } from "@/lib/server/hr-access";
import { formatAmount, inferStatus, STATUS_COLORS, STATUS_LABEL, type Invoice } from "@/lib/invoice";
import { InvoiceActions } from "@/components/InvoiceActions";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: "18px 20px", background: "#fff", marginTop: 16 };
const fieldLabel: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800, marginBottom: 3 };
const fieldValue: React.CSSProperties = { fontSize: 13.5, color: "#1b2331", fontWeight: 600 };

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invId: string }> }) {
  await requireAdminPage();
  const { invId } = await params;

  let invoice: Invoice | null = null;
  try {
    invoice = (await hrFetch<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`)).invoice;
  } catch {
    notFound();
  }
  if (!invoice) notFound();

  const liveStatus = inferStatus(invoice);
  const col = STATUS_COLORS[liveStatus];

  const lines = invoice.lineItems?.length
    ? invoice.lineItems
    : [{ description: invoice.description, qty: 1, rate: invoice.amount, amount: invoice.amount }];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link href="/invoices" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Invoices</Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", margin: 0 }}>{invoice.invId}</h1>
            <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "3px 10px", background: col.bg, color: col.fg }}>
              {STATUS_LABEL[liveStatus]}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "#5b6676", marginTop: 4 }}>{invoice.clientName} · {formatAmount(invoice.totalAmount)}</div>
        </div>
        {/* Action bar */}
        <InvoiceActions invoice={invoice} liveStatus={liveStatus} />
      </div>

      {/* Detail grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={card}>
          <div style={fieldLabel}>Client</div>
          <div style={fieldValue}>{invoice.clientName}</div>
          {invoice.clientEmail && <div style={{ fontSize: 12.5, color: "#5b6676", marginTop: 2 }}>{invoice.clientEmail}</div>}
          {invoice.clientAddress && <div style={{ fontSize: 12.5, color: "#5b6676" }}>{invoice.clientAddress}</div>}
          {invoice.clientGstin && <div style={{ fontSize: 12, color: "#5b6676" }}>GSTIN: {invoice.clientGstin}</div>}
        </div>
        <div style={card}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={fieldLabel}>Issue date</div>
              <div style={fieldValue}>{invoice.issueDate || "—"}</div>
            </div>
            <div>
              <div style={fieldLabel}>Due date</div>
              <div style={{ ...fieldValue, color: liveStatus === "overdue" ? "#9a2233" : "#1b2331" }}>{invoice.dueDate || "—"}</div>
            </div>
            {invoice.paidDate && (
              <div>
                <div style={fieldLabel}>Paid date</div>
                <div style={{ ...fieldValue, color: "#1a7a45" }}>{invoice.paidDate}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div style={card}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800, marginBottom: 12 }}>Services</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: 11, color: "#8a94a3", padding: "0 0 8px", fontWeight: 800 }}>Description</th>
              <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 8px 8px", fontWeight: 800 }}>Qty</th>
              <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 8px 8px", fontWeight: 800 }}>Rate</th>
              <th style={{ textAlign: "right", fontSize: 11, color: "#8a94a3", padding: "0 0 8px 8px", fontWeight: 800 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid #eef2f7" }}>
                <td style={{ padding: "10px 0", color: "#1b2331" }}>{l.description}</td>
                <td style={{ padding: "10px 0 10px 8px", textAlign: "right", color: "#5b6676" }}>{l.qty}</td>
                <td style={{ padding: "10px 0 10px 8px", textAlign: "right", color: "#5b6676" }}>{formatAmount(l.rate)}</td>
                <td style={{ padding: "10px 0 10px 8px", textAlign: "right", fontWeight: 700 }}>{formatAmount(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {(invoice.gstAmount ?? 0) > 0 && (
              <tr style={{ borderTop: "1px solid #eef2f7" }}>
                <td colSpan={3} style={{ padding: "8px 0", textAlign: "right", color: "#5b6676" }}>GST @ {invoice.gstRate}%</td>
                <td style={{ padding: "8px 0 8px 8px", textAlign: "right" }}>{formatAmount(invoice.gstAmount)}</td>
              </tr>
            )}
            <tr style={{ borderTop: "2px solid #1f3a5f" }}>
              <td colSpan={3} style={{ padding: "10px 0", fontWeight: 800, color: "#1f3a5f", fontSize: 14 }}>Total</td>
              <td style={{ padding: "10px 0 10px 8px", textAlign: "right", fontWeight: 800, color: "#1f3a5f", fontSize: 16, fontVariantNumeric: "tabular-nums" }}>
                {formatAmount(invoice.totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div style={card}>
          <div style={fieldLabel}>Notes</div>
          <div style={{ fontSize: 13, color: "#1b2331", marginTop: 4 }}>{invoice.notes}</div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 28, borderTop: "1px solid #eef2f7", paddingTop: 14 }}>
        Created {new Date(invoice.createdAt).toLocaleString("en-GB")} ·{" "}
        Last updated {new Date(invoice.updatedAt).toLocaleString("en-GB")}
      </div>
    </main>
  );
}
