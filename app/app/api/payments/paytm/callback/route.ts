import { NextResponse } from "next/server";
import { getOrder, markOrderPaid } from "@/lib/server/orders";
import { transactionStatus } from "@/lib/payments/paytm";

// Paytm's redirect/callback target (used if the flow redirects instead of using the JS
// popup). Paytm POSTs the result here — but we don't trust the posted body; we re-confirm
// server-to-server via the Order Status API and grant only on a real TXN_SUCCESS (the
// engine re-validates the amount against the persisted order). The grant goes to the
// order's owner (from server state), so no user session is needed on this POST.
const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === "1";

export async function POST(req: Request) {
  if (!PAYMENTS_LIVE) {
    return new NextResponse("not found", { status: 404 });
  }
  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId") ?? "";
  let ok = false;
  if (orderId) {
    const order = await getOrder(orderId);
    if (order) {
      const st = await transactionStatus(orderId);
      if (st.status === "TXN_SUCCESS") {
        const { granted } = await markOrderPaid(orderId, st.paymentId ?? "", st.amountMinor, st.currency);
        ok = granted;
      }
    }
  }
  // Send the learner back into the app with the result.
  const dest = new URL(ok ? "/dashboard?paid=1" : "/dashboard?paid=0", url.origin);
  return NextResponse.redirect(dest, 303);
}

// Some Paytm configurations issue a GET to the callback — handle it the same way.
export async function GET(req: Request) {
  return POST(req);
}
