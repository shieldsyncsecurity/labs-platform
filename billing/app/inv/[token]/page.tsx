import { notFound } from "next/navigation";
import { verifyInvoiceToken } from "@/lib/inv-token";
import { engineGet } from "@/lib/hr-engine";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import type { Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invId = await verifyInvoiceToken(decodeURIComponent(token));
  if (!invId) notFound();

  let invoice: Invoice | null = null;
  try {
    invoice = (await engineGet<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`)).invoice;
  } catch {
    notFound();
  }
  if (!invoice) notFound();

  return <InvoiceDoc invoice={invoice} />;
}
