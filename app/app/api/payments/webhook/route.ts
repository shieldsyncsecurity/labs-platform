import { NextResponse } from "next/server";
import { verifyProviderWebhook } from "@/lib/payments/provider";
import { getOrder, markOrderPaid } from "@/lib/server/orders";

// REAL PROVIDER WEBHOOK — the production payment-confirmation (entitlement-grant)
// path. Reachable only when PAYMENTS_LIVE=1.
//
// Trust model (do NOT weaken — this is the route that grants paid access):
//  1. Verify the signature with the REAL provider secret (provider webhook secret),
//     NOT any internal key. A token minted by /checkout can never validate here —
//     that closes the replay / self-grant bypass.
//  2. The grant is performed by the ENGINE, not here: the engine re-validates the
//     payment amount/currency against the SERVER-PERSISTED order, derives the access
//     window from its own rules, grants the entitlement idempotently, then records
//     created->paid (one engine call, authoritative). This route only proves the
//     provider event is genuine and forwards it. A client can never reach the grant.
// Every step fails CLOSED.
const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === "1";

export async function POST(req: Request) {
  if (!PAYMENTS_LIVE) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Always read the RAW body — the provider HMACs the exact bytes; parsing first
  // would change them and break verification.
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  // 1. Trust ONLY a signature the provider made with RAZORPAY_WEBHOOK_SECRET.
  const evt = verifyProviderWebhook(raw, signature);
  if (!evt) {
    return NextResponse.json({ ok: false, reason: "invalid signature" }, { status: 400 });
  }
  if (evt.status !== "captured") {
    return NextResponse.json({ ok: false, reason: "payment not captured" }, { status: 400 });
  }

  // 2. Confirm the order exists, and fail FAST (400, don't retry) on an amount
  //    mismatch — an unguessable persisted order whose amount disagrees with the
  //    event is fraud/error, never a transient. (The engine re-checks too.)
  const order = await getOrder(evt.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, reason: "unknown order" }, { status: 400 });
  }
  if (order.amountMinor !== evt.amountMinor || order.currency !== evt.currency) {
    return NextResponse.json({ ok: false, reason: "amount mismatch" }, { status: 400 });
  }

  // 3. Hand off to the ENGINE, which re-validates amount/currency vs the persisted
  //    order, grants the entitlement (idempotent, derived from the stored order, window
  //    computed engine-side), then records created->paid. We return ok ONLY if it
  //    granted; otherwise 5xx so the provider redelivers (no "charged, no access").
  const { granted } = await markOrderPaid(order.id, evt.paymentId, evt.amountMinor, evt.currency);
  if (!granted) {
    return NextResponse.json({ ok: false, reason: "grant failed, retry" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
