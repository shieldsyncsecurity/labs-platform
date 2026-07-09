import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import PrintActions from "./print-actions";
import {
  buyerMeta,
  computeInvoice,
  formatMoneyMinor,
  invoiceNumber,
  sellerMetaFromEnv,
  type InvoiceOrder,
  type InvoiceOrg,
} from "./invoice-model";

export const metadata: Metadata = {
  title: "Tax invoice",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function fmtDate(value?: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}

// Print CSS: on paper we hide the app chrome / action bar (.no-print) and let
// the invoice card fill the sheet with plain black-on-white. Kept inline so the
// route is self-contained (no globals.css edits outside this boundary).
const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  .invoice-shell { background: #ffffff !important; padding: 0 !important; }
  .invoice-card { border: none !important; box-shadow: none !important; max-width: none !important; margin: 0 !important; }
  body { background: #ffffff !important; }
}
`;

// Staff-only (W3B-2): a print-clean GST tax invoice for one paid/created order.
// Read-only, so the boolean getAdminSession() gate is the right shape. The order
// is located by scanning the org's billing history (the engine exposes no
// single-order GET); a mismatched orderId 404s.
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ orgId: string; orderId: string }>;
}) {
  const { orgId, orderId } = await params;

  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  // Org (bill-to context) -- 404 if the org itself is gone.
  let org: InvoiceOrg | undefined;
  try {
    org = await entFetch<InvoiceOrg>("/ent/orgs", { query: { orgId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      notFound();
    }
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-rose-700">Could not load this invoice right now.</p>
      </div>
    );
  }
  if (!org) notFound();

  // Order -- from the org's billing history, matched by id.
  let order: InvoiceOrder | undefined;
  try {
    const data = await entFetch<{ orders?: InvoiceOrder[] }>("/ent/orders", { query: { orgId } });
    order = (data?.orders ?? []).find((o) => o.orderId === orderId);
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-sm text-rose-700">Could not load this invoice right now.</p>
      </div>
    );
  }
  if (!order) notFound();

  const seller = sellerMetaFromEnv();
  const buyer = buyerMeta(order, org);
  const comp = computeInvoice(order, org, seller.state);
  const invNo = invoiceNumber(order);
  const money = (m: number) => formatMoneyMinor(m, comp.currency);
  const pdfHref = `/api/admin/invoice/pdf?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(orderId)}`;

  return (
    <div className="invoice-shell min-h-screen bg-canvas px-6 py-8">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="mx-auto max-w-3xl">
        {/* Toolbar (never printed) */}
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href={`/admin/orgs/${orgId}`} className="text-xs text-muted hover:text-brand-strong">
            &larr; Back to organization
          </Link>
          <PrintActions pdfHref={pdfHref} />
        </div>

        {/* Invoice card */}
        <div className="invoice-card rounded-xl border border-line bg-surface p-8 text-ink">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
            <div>
              <h1 className="text-xl font-bold text-ink">Tax invoice</h1>
              <p className="mt-1 text-sm text-muted">
                {order.status === "paid" ? (
                  <span className="font-semibold text-emerald-700">PAID</span>
                ) : (
                  <span className="font-semibold text-amber-700">Awaiting payment</span>
                )}
              </p>
            </div>
            <div className="text-right text-sm">
              <p className="font-mono font-semibold text-ink">{invNo}</p>
              <p className="mt-1 text-xs text-muted">Invoice date: {fmtDate(order.createdAt)}</p>
              {order.paidAt ? (
                <p className="text-xs text-muted">Payment date: {fmtDate(order.paidAt)}</p>
              ) : null}
            </div>
          </div>

          {/* Seller + Bill-to */}
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">From</h2>
              <p className="mt-1 text-sm font-semibold text-ink">{seller.legalName}</p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-ink-soft">{seller.address}</p>
              <p className="mt-1 font-mono text-xs text-ink-soft">GSTIN: {seller.gstin}</p>
              <p className="text-xs text-ink-soft">State of supply: {seller.state}</p>
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Bill to</h2>
              <p className="mt-1 text-sm font-semibold text-ink">{buyer.name || "-"}</p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-ink-soft">
                {buyer.address || "-"}
              </p>
              <p className="mt-1 font-mono text-xs text-ink-soft">
                GSTIN: {buyer.gstin || "Unregistered / not provided"}
              </p>
              <p className="text-xs text-ink-soft">
                Place of supply: {buyer.placeOfSupply || "Not determined"}
              </p>
            </div>
          </div>

          {/* Line items */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Rate (incl.)</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount (incl.)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className="px-3 py-3 text-ink">Assessment credits</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{comp.credits}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                    {money(comp.unitMinor)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-ink">
                    {money(comp.totalMinor)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Tax summary */}
          <div className="mt-6 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Taxable value</dt>
                <dd className="tabular-nums text-ink-soft">{money(comp.taxableMinor)}</dd>
              </div>
              {comp.intraState ? (
                <>
                  <div className="flex justify-between">
                    <dt className="text-muted">CGST @9% (incl.)</dt>
                    <dd className="tabular-nums text-ink-soft">{money(comp.cgstMinor)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">SGST @9% (incl.)</dt>
                    <dd className="tabular-nums text-ink-soft">{money(comp.sgstMinor)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-muted">IGST @18% (incl.)</dt>
                  <dd className="tabular-nums text-ink-soft">{money(comp.igstMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-line pt-1.5">
                <dt className="text-muted">GST @18% (incl.)</dt>
                <dd className="tabular-nums text-ink-soft">{money(comp.taxMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-line pt-1.5 text-base font-bold text-ink">
                <dt>Total (incl. GST)</dt>
                <dd className="tabular-nums">{money(comp.totalMinor)}</dd>
              </div>
            </dl>
          </div>

          {order.note ? (
            <div className="mt-6 border-t border-line pt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Note</h2>
              <p className="mt-1 text-sm text-ink-soft">{order.note}</p>
            </div>
          ) : null}

          {/* Founder-owns-filing footnote */}
          <p className="mt-8 border-t border-line pt-4 text-[11px] leading-4 text-muted">
            This is a system-generated tax invoice. GST is shown on a tax-inclusive basis for display;
            verify all figures before filing. {seller.legalName} retains responsibility for statutory
            filing.
          </p>
        </div>
      </div>
    </div>
  );
}
