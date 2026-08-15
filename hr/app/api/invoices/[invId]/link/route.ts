// Generate a shareable, token-authenticated URL for a client to view their invoice.
// Admin-only — only the person who issues the invoice can create the link.
import { NextRequest, NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";
import { signInvoiceToken } from "@/lib/server/inv-token";

export const dynamic = "force-dynamic";

function safeInvId(id: string): boolean {
  return /^INV-\d{4}-\d{2}-\d{3}$/.test(id);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ invId: string }> }) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { invId } = await params;
  if (!safeInvId(invId)) return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });

  // Verify the invoice exists before handing out a token for it
  try {
    await hrFetch(`/hr/invoices/${encodeURIComponent(invId)}`);
  } catch {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }

  const token = await signInvoiceToken(invId);
  // Client invoices are served ONLY by the separate billing Worker. In dev,
  // point at the local billing dev server (`npm run dev` in billing/ → :3004);
  // the HR portal no longer hosts an /inv view.
  const billingOrigin =
    process.env.NODE_ENV === "production"
      ? "https://billing.shieldsyncsecurity.com"
      : "http://localhost:3004";
  const url = `${billingOrigin}/inv/${encodeURIComponent(token)}`;
  return NextResponse.json({ url, token });
}
