import { getGstSettings } from "@/lib/server/settings";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "New invoice — ShieldSync HR", robots: { index: false, follow: false } };

// Server wrapper: reads the in-app GST setting so the form knows whether to
// offer the GST row (and at what default rate) — no hardcoded flag.
export default async function NewInvoicePage() {
  const gst = await getGstSettings();
  return <NewInvoiceForm gstRegistered={gst.registered} defaultRate={gst.defaultRate} />;
}
