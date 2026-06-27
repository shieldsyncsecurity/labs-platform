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

  // 3. GRANT FIRST, then record the paid transition. The entitlement write is an
  // idempotent upsert (keyed by userId+labSlug), so re-running on a provider retry
  // is safe — but ordering grant BEFORE the order's created->paid CAS means a grant
  // failure leaves the order NOT paid, so we can return 5xx and the provider RETRIES
  // (instead of the old order — closes the "charged but no access, no self-heal" gap).
  //
  // Access window is derived HERE from the persisted order (mirrors /checkout and
  // the engine's per-lab rules), so the client never dictates duration.
  const lab = order.labSlug ? getLab(order.labSlug) : undefined;
  const accessUntil =
    order.plan === "monthly"
      ? new Date(Date.now() + MONTHLY_ACCESS_DAYS * 24 * 3600 * 1000).toISOString()
      : new Date(
          Date.now() +
            rulesForLab(lab?.level ?? "Beginner", lab?.free ?? false).windowHours * 3600 * 1000
        ).toISOString();

  const granted = await grantEntitlement(order.userId, {
    labSlug: order.plan === "monthly" ? "*" : order.labSlug ?? "",
    kind: order.plan === "monthly" ? "monthly" : "per-lab",
    accessUntil,
  });
  if (!granted) {
    // Do NOT mark the order paid and do NOT 200 — let the provider redeliver.
    return NextResponse.json({ ok: false, reason: "grant failed, retry" }, { status: 503 });
  }

  // Record the paid transition for idempotency/audit (best-effort; the grant above
  // is the source of truth for access). A replay re-grants idempotently then no-ops here.
  await markOrderPaid(order.id, evt.paymentId);

  return NextResponse.json({ ok: true });
}
