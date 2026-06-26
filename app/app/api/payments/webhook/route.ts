import { NextResponse } from "next/server";
import { verifyProviderWebhook } from "@/lib/payments/provider";
import { getOrder, markOrderPaid } from "@/lib/server/orders";
import { grantEntitlement } from "@/lib/server/store";
import { getLab } from "@/lib/labs";
import { rulesForLab, MONTHLY_ACCESS_DAYS } from "@/lib/access-rules";

// REAL PROVIDER WEBHOOK — the production payment-confirmation (entitlement-grant)
// path. Reachable only when PAYMENTS_LIVE=1.
//
// Trust model (do NOT weaken — this is the route that grants paid access):
//  1. Verify the signature with the REAL provider secret (RAZORPAY_WEBHOOK_SECRET),
//     NOT the internal MOCK_PAYMENT_SECRET. A token minted by /checkout is signed
//     with the mock secret and so can never validate here — that closes the
//     replay / self-grant bypass.
//  2. Validate the payment against a SERVER-PERSISTED order (amount + currency
//     must match what we recorded at checkout), never a self-describing client
//     payload.
//  3. Gate the grant on an idempotent created->paid transition, so a replayed
//     provider delivery can't double-grant.
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

  // 2. Validate against the server-side order, not the event's self-claims.
  const order = await getOrder(evt.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, reason: "unknown order" }, { status: 400 });
  }
  if (order.amountMinor !== evt.amountMinor || order.currency !== evt.currency) {
    return NextResponse.json({ ok: false, reason: "amount mismatch" }, { status: 400 });
  }

  // 3. Idempotent created->paid: only the winning transition grants access.
  const transitioned = await markOrderPaid(order.id, evt.paymentId);
  if (!transitioned) {
    // Already paid (or the order store couldn't commit) — do NOT (re)grant.
    // 200 so the provider stops retrying an event we've already handled.
    return NextResponse.json({ ok: true, idempotent: true });
  }

  // Access window is derived HERE from the persisted order (mirrors /checkout
  // and the engine's per-lab rules), so the client never dictates duration.
  const lab = order.labSlug ? getLab(order.labSlug) : undefined;
  const accessUntil =
    order.plan === "monthly"
      ? new Date(Date.now() + MONTHLY_ACCESS_DAYS * 24 * 3600 * 1000).toISOString()
      : new Date(
          Date.now() +
            rulesForLab(lab?.level ?? "Beginner", lab?.free ?? false).windowHours * 3600 * 1000
        ).toISOString();

  await grantEntitlement(order.userId, {
    labSlug: order.plan === "monthly" ? "*" : order.labSlug ?? "",
    kind: order.plan === "monthly" ? "monthly" : "per-lab",
    accessUntil,
  });

  return NextResponse.json({ ok: true });
}
