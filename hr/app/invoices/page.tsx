import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { requireAdminPage } from "@/lib/server/hr-access";
import { formatAmount, inferStatus, STATUS_COLORS, STATUS_LABEL, type Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices — ShieldSync HR", robots: { index: false, follow: false } };

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: "18px 20px", background: "#fff", marginTop: 20 };
const th: React.CSSProperties = { padding: "7px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", textAlign: "left" as const, fontWeight: 800 };
function td(extra?: React.CSSProperties): React.CSSProperties {
  return { padding: "11px 12px", fontSize: 13, borderTop: "1px solid #eef2f7", ...extra };
}

export default async function InvoicesPage() {
  await requireAdminPage();

  let invoices: Invoice[] = [];
  try {
    invoices = (await hrFetch<{ invoices: Invoice[] }>("/hr/invoices")).invoices ?? [];
  } catch { /* empty */ }

  // Derive live status (overdue if due date passed and still sent)
  const rows = invoices.map((inv) => ({ ...inv, liveStatus: inferStatus(inv) }));

  const totalBilled = rows.reduce((s, r) => s + (r.totalAmount ?? 0), 0);
  const totalPaid = rows.filter((r) => r.liveStatus === "paid").reduce((s, r) => s + (r.paidAmount ?? r.totalAmount ?? 0), 0);
  const outstanding = rows.filter((r) => r.liveStatus === "sent" || r.liveStatus === "overdue").reduce((s, r) => s + (r.totalAmount ?? 0), 0);
  const overdueCount = rows.filter((r) => r.liveStatus === "overdue").length;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px 56px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Home</Link>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Invoices</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676", marginTop: 4 }}>
            B2B client invoices — consulting, partnerships, OEM deals.
          </p>
        </div>
        <Link
          href="/invoices/new"
          style={{ background: "#1f3a5f", color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, textDecoration: "none" }}
        >
          + New invoice
        </Link>
      </div>

      {/* Summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginTop: 20 }}>
        {[
          { label: "Total billed", value: formatAmount(totalBilled), sub: `${rows.length} invoice${rows.length === 1 ? "" : "s"}`, color: "#1f3a5f" },
          { label: "Collected", value: formatAmount(totalPaid), sub: `${rows.filter(r => r.liveStatus === "paid").length} paid`, color: "#1a7a45" },
          { label: "Outstanding", value: formatAmount(outstanding), sub: `${rows.filter(r => r.liveStatus === "sent").length} sent`, color: "#b0782f" },
          { label: "Overdue", value: String(overdueCount), sub: overdueCount ? "action required" : "None overdue", color: overdueCount ? "#9a2233" : "#1a7a45" },
        ].map((tile) => (
          <div key={tile.label} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: "14px 16px", background: "#fff" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "#8a94a3", fontWeight: 800 }}>{tile.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: tile.color, marginTop: 6 }}>{tile.value}</div>
            <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 3 }}>{tile.sub}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px", background: "#f8fafc" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1f3a5f" }}>No invoices yet</div>
          <div style={{ fontSize: 13, color: "#8a94a3", marginTop: 6 }}>Create your first B2B invoice to track client billing.</div>
          <Link
            href="/invoices/new"
            style={{ display: "inline-block", marginTop: 16, background: "#1f3a5f", color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 20px", borderRadius: 8, textDecoration: "none" }}
          >
            Create first invoice
          </Link>
        </div>
      ) : (
        <div style={card}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Invoice #</th>
                  <th style={th}>Client</th>
                  <th style={th}>Description</th>
                  <th style={th}>Issue date</th>
                  <th style={th}>Due date</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                  <th style={th}>Status</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const col = STATUS_COLORS[inv.liveStatus];
                  return (
                    <tr key={inv.invId}>
                      <td style={td({ fontWeight: 700, color: "#2f4fb0", whiteSpace: "nowrap" })}>
                        <Link href={`/invoices/${inv.invId}`} style={{ color: "#2f4fb0", textDecoration: "none" }}>
                          {inv.invId}
                        </Link>
                      </td>
                      <td style={td({ fontWeight: 600, color: "#1b2331" })}>{inv.clientName}</td>
                      <td style={td({ color: "#5b6676", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                        {inv.description}
                      </td>
                      <td style={td({ color: "#5b6676", whiteSpace: "nowrap" })}>{inv.issueDate}</td>
                      <td style={td({ color: inv.liveStatus === "overdue" ? "#9a2233" : "#5b6676", whiteSpace: "nowrap" })}>
                        {inv.dueDate || "—"}
                      </td>
                      <td style={td({ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" })}>
                        {formatAmount(inv.totalAmount)}
                      </td>
                      <td style={td()}>
                        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 9px", background: col.bg, color: col.fg }}>
                          {STATUS_LABEL[inv.liveStatus]}
                        </span>
                      </td>
                      <td style={td({ whiteSpace: "nowrap" })}>
                        <Link href={`/invoices/${inv.invId}`} style={{ fontSize: 12, color: "#2f4fb0", textDecoration: "none" }}>
                          View &rarr;
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
