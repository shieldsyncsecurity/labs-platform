import { notFound } from "next/navigation";
import { hrFetch } from "@/lib/server/hr-engine";
import { requireAdminPage } from "@/lib/server/hr-access";
import { getGstSettings } from "@/lib/server/settings";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import type { Invoice } from "@/lib/invoice";

export const dynamic = "force-dynamic";

export default async function InvoiceViewPage({ params }: { params: Promise<{ invId: string }> }) {
  await requireAdminPage();
  const { invId } = await params;

  let invoice: Invoice | null = null;
  try {
    invoice = (await hrFetch<{ invoice: Invoice }>(`/hr/invoices/${encodeURIComponent(invId)}`)).invoice;
  } catch {
    notFound();
  }
  if (!invoice) notFound();

  const gst = await getGstSettings();
  return <InvoiceDoc invoice={invoice} sellerGstin={gst.gstin} />;
}
