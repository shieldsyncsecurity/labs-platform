// Public, token-authenticated invoice view.
// Anyone with the link can view the invoice — no HR login required.
// The token is a signed JWT (HS256, audience "ss-inv") that encodes the invId.
import { notFound } from "next/navigation";
import { hrFetch } from "@/lib/server/hr-engine";
import { verifyInvoiceToken } from "@/lib/server/inv-token";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import type { Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invId = await verifyInvoiceToken(decodeURIComponent(token));
  if (!invId) notFound();

  let invoice: Invoice | null = null;
  try {
    invoice = (await hrFetch<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`)).invoice;
  } catch {
    notFound();
  }
  if (!invoice) notFound();

  return <InvoiceDoc invoice={invoice} />;
}
