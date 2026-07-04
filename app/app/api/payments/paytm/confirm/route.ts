import { NextResponse } from "next/server";
import { getServerUser } from "@/lib/auth/session";
import { getOrder, markOrderPaid } from "@/lib/server/orders";
import { transactionStatus, paymentsEnabled } from "@/lib/payments/paytm";

// Server-AUTHORITATIVE payment confirmation. The browser's Paytm JS Checkout calls this
// after the popup completes — but we do NOT trust the client's claim of success. We ask
// Paytm directly (Order Status API) and only grant on a real TXN_SUCCESS. The engine then
// re-validates the amount against the persisted order and grants idempotently.
export async function POST(req: Request) {
  // Read at request time (Worker env isn't populated at module scope). Requires
  // PAYMENTS_LIVE=1 AND PAYTM_ENV=production so staging can't confirm real users.
  if (!paymentsEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { orderId } = (await req.json().catch(() => ({}))) as { orderId?: string };
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "missing orderId" }, { status: 400 });
  }
  const order = await getOrder(orderId);
  if (!order) {
    return NextResponse.json({ error: "unknown order" }, { status: 404 });
  }
  if (order.userId !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 }); // confirm only your own order
  }

  // Authoritative server-to-server status — the source of truth, not the client.
  const st = await transactionStatus(orderId);
  if (st.status !== "TXN_SUCCESS") {
    return NextResponse.json({ paid: false, status: st.status ?? "UNKNOWN" });
  }
  // Engine re-validates amount/currency vs the persisted order and grants idempotently.
  const { granted } = await markOrderPaid(orderId, st.paymentId ?? "", st.amountMinor, st.currency);
  return NextResponse.json({ paid: granted, status: "TXN_SUCCESS" });
}
