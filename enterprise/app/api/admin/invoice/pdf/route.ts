import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";
import { buildTextPdf, sanitizeToAscii } from "@/lib/pdf/text-pdf";
import {
  buyerMeta,
  computeInvoice,
  invoiceNumber,
  renderInvoiceText,
  sellerMetaFromEnv,
  type InvoiceOrder,
  type InvoiceOrg,
} from "@/app/admin/orgs/[orgId]/orders/[orderId]/invoice/invoice-model";

export const dynamic = "force-dynamic";

// Hex SHA-256 via Web Crypto (present on the Workers runtime AND Node 18+), so
// the PDF footer carries a genuine integrity hash of the rendered body rather
// than a placeholder. No dependency, no Buffer.
async function sha256Hex(text: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

// Staff-only (W3B-2): the same GST tax invoice as the HTML view, rendered to a
// dependency-free PDF via lib/pdf/text-pdf. Read-only => boolean
// getAdminSession() gate, fail-closed like every app/api/admin/* route. Both
// orgId and orderId are required: the engine has no single-order GET, so the
// order is located inside the org's billing history.
export async function GET(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") ?? "").trim();
  const orderId = (url.searchParams.get("orderId") ?? "").trim();
  if (!orgId || !orderId) {
    return NextResponse.json({ error: "orgId and orderId are required" }, { status: 400 });
  }

  let org: InvoiceOrg;
  try {
    org = await entFetch<InvoiceOrg>("/ent/orgs", { query: { orgId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the organization." }, { status: 502 });
  }

  let order: InvoiceOrder | undefined;
  try {
    const data = await entFetch<{ orders?: InvoiceOrder[] }>("/ent/orders", { query: { orgId } });
    order = (data?.orders ?? []).find((o) => o.orderId === orderId);
  } catch {
    return NextResponse.json({ error: "Could not load the order." }, { status: 502 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found for this organization." }, { status: 404 });
  }

  const seller = sellerMetaFromEnv();
  const buyer = buyerMeta(order, org);
  const comp = computeInvoice(order, org, seller.state);
  const invNo = invoiceNumber(order);

  const orgName = (org.name ?? "").trim();
  const title = sanitizeToAscii(
    orgName ? `Tax Invoice ${invNo} -- ${orgName}` : `Tax Invoice ${invNo}`,
  );
  const bodyText = sanitizeToAscii(renderInvoiceText(order, seller, buyer, comp));
  const hash = await sha256Hex(bodyText);

  const pdfBytes = buildTextPdf({ title, bodyText, hash });

  // Filename from the invoice number, ASCII + filesystem-safe.
  const safeInv = invNo.replace(/[^A-Za-z0-9._-]+/g, "-");
  const filename = `shieldsync-invoice-${safeInv}.pdf`;

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
