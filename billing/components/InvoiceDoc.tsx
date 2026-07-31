import { LETTERHEAD_CSS } from "./letterhead-css";
import { formatAmount, invoiceSellerBlock, PAYMENT_DETAILS, type Invoice, type LineItem } from "@/lib/invoice";
import { COMPANY } from "@/lib/company";

function TotalRow({ label, value, bold, large }: { label: string; value: string; bold?: boolean; large?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "5px 0", fontSize: large ? 14 : 12, color: "#5b6676", width: "60%" }}>{label}</td>
      <td style={{ padding: "5px 0", fontSize: large ? 14 : 12, textAlign: "right", fontWeight: bold ? 800 : 600, color: bold ? "#1f3a5f" : "#1b2331" }}>
        {value}
      </td>
    </tr>
  );
}

export function InvoiceDoc({ invoice }: { invoice: Invoice }) {
  const seller = invoiceSellerBlock();
  const items: LineItem[] = invoice.lineItems?.length
    ? invoice.lineItems
    : [{ description: invoice.description, qty: 1, rate: invoice.amount, amount: invoice.amount }];

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const gstAmount = invoice.gstAmount ?? 0;
  const total = invoice.totalAmount ?? subtotal + gstAmount;

  const issueDate = invoice.issueDate
    ? new Date(invoice.issueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    : "—";
  const dueDate = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    : "—";

  const invoiceCSS = `
    .inv-items th { background:#1f3a5f; color:#fff; font-size:11px; text-transform:uppercase;
      letter-spacing:.06em; padding:8px 10px; text-align:left; }
    .inv-items td { padding:8px 10px; font-size:12px; border-bottom:1px solid #eef2f7; }
    .inv-items tr:last-child td { border-bottom:none; }
    .inv-paid-stamp { position:absolute; top:80px; right:40px; border:4px solid #15803d;
      color:#15803d; font-size:28px; font-weight:900; padding:6px 18px; border-radius:4px;
      letter-spacing:3px; transform:rotate(-15deg); opacity:.55; pointer-events:none; }
    body { margin:0; padding:0; background:#6b7280; }
  `;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{invoice.invId} — {invoice.clientName}</title>
        <style dangerouslySetInnerHTML={{ __html: LETTERHEAD_CSS + invoiceCSS }} />
      </head>
      <body>
        <div className="ss-stage">
          <div className="ss-sheet" style={{ position: "relative" }}>
            {invoice.status === "paid" && <div className="inv-paid-stamp">PAID</div>}

            {/* Letterhead */}
            <div className="ss-mast">
              <div>
                <div className="ss-name">{COMPANY.shortName}</div>
                <div className="ss-tag">{COMPANY.tagline}</div>
                <div className="ss-contact">
                  {seller.email} · {COMPANY.phone} · {COMPANY.website}
                </div>
              </div>
            </div>

            {/* Invoice header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#1f3a5f", letterSpacing: ".5px" }}>TAX INVOICE</div>
                <div style={{ fontSize: 13, color: "#5b6676", marginTop: 3 }}>{invoice.invId}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12 }}>
                <div><b>Issue date:</b> {issueDate}</div>
                <div><b>Due date:</b> {dueDate}</div>
              </div>
            </div>

            {/* From / To */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 6 }}>From</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1f3a5f" }}>{seller.legalName}</div>
                <div style={{ fontSize: 11.5, color: "#5b6676", marginTop: 3 }}>{seller.address}</div>
                <div style={{ fontSize: 11.5, color: "#5b6676" }}>PAN: {seller.pan}</div>
                {seller.gstin && <div style={{ fontSize: 11.5, color: "#5b6676" }}>GSTIN: {seller.gstin}</div>}
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 6 }}>Bill To</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1f3a5f" }}>{invoice.clientName}</div>
                {invoice.clientAddress && <div style={{ fontSize: 11.5, color: "#5b6676", marginTop: 3 }}>{invoice.clientAddress}</div>}
                {invoice.clientGstin && <div style={{ fontSize: 11.5, color: "#5b6676" }}>GSTIN: {invoice.clientGstin}</div>}
                {invoice.clientEmail && <div style={{ fontSize: 11.5, color: "#5b6676" }}>{invoice.clientEmail}</div>}
              </div>
            </div>

            {/* Line items */}
            <table className="inv-items" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
              <thead>
                <tr>
                  <th style={{ width: "50%" }}>Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate (₹)</th>
                  <th style={{ textAlign: "right" }}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td style={{ textAlign: "right" }}>{item.qty}</td>
                    <td style={{ textAlign: "right" }}>{formatAmount(item.rate)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{formatAmount(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <table style={{ width: 280, borderCollapse: "collapse" }}>
                <tbody>
                  <TotalRow label="Subtotal" value={formatAmount(subtotal)} />
                  {gstAmount > 0 && invoice.gstRate > 0 && (
                    <TotalRow label={`GST @ ${invoice.gstRate}%`} value={formatAmount(gstAmount)} />
                  )}
                  <tr><td colSpan={2} style={{ borderTop: "2px solid #1f3a5f", paddingTop: 6 }} /></tr>
                  <TotalRow label="Total Due" value={formatAmount(total)} bold large />
                </tbody>
              </table>
            </div>

            {/* Payment details */}
            {(PAYMENT_DETAILS.accountNo || PAYMENT_DETAILS.upi) ? (
              <div style={{ marginTop: 24, background: "#f8fafc", borderRadius: 8, padding: "12px 14px", fontSize: 11.5 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 6 }}>Payment details</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <b>Bank:</b> {PAYMENT_DETAILS.bankName}<br />
                    <b>Account name:</b> {PAYMENT_DETAILS.accountName}
                  </div>
                  <div>
                    {PAYMENT_DETAILS.accountNo && <><b>A/c no:</b> {PAYMENT_DETAILS.accountNo}<br /></>}
                    {PAYMENT_DETAILS.ifsc && <><b>IFSC:</b> {PAYMENT_DETAILS.ifsc}<br /></>}
                    {PAYMENT_DETAILS.upi && <><b>UPI:</b> {PAYMENT_DETAILS.upi}</>}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 20, fontSize: 11.5, color: "#8a94a3", borderTop: "1px solid #eef2f7", paddingTop: 14 }}>
                Please transfer to the company bank account. Contact {COMPANY.email} for payment details.
              </div>
            )}

            {invoice.notes && (
              <div style={{ marginTop: 16, fontSize: 11.5, color: "#5b6676" }}>
                <b>Notes:</b> {invoice.notes}
              </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: 24, borderTop: "2px solid #1f3a5f", paddingTop: 10, fontSize: 10.5, color: "#8a94a3", display: "flex", justifyContent: "space-between" }}>
              <span>{COMPANY.legalName} · CIN: {COMPANY.cin}</span>
              <span>This is a computer-generated invoice.</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
