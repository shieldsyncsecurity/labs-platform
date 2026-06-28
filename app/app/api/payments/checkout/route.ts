import { NextResponse } from "next/server";
import { priceFor } from "@/lib/payments/pricing";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";
import { createOrder } from "@/lib/server/orders";
import { initiateTransaction, paytmConfig } from "@/lib/payments/paytm";
import type { CheckoutRequest, Order } from "@/lib/payments/types";

// Start a Paytm checkout. AUTH-ONLY and gated behind PAYMENTS_LIVE.
//  1. The order amount/plan/lab are validated + priced SERVER-SIDE (never the client's
//     word) and the order is persisted (it's the source of truth the grant validates against).
//  2. We ask Paytm to initiate the transaction and return a txnToken the browser's
//     Paytm JS Checkout uses. The merchant KEY never leaves the server; only the MID
//     (public) + txnToken go to the client.
// Payment success is confirmed later, server-to-server, via /paytm/confirm (or /callback) —
// the client's claim of "paid" is never trusted.
const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === "1";

export async function POST(req: Request) {
  if (!PAYMENTS_LIVE) {
    return NextResponse.json({ error: "payments not available yet" }, { status: 503 });
  }
  const sessionUser = await getServerUser();
  if (!sessionUser?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as CheckoutRequest;
  const userId = sessionUser.id; // verified session only — never body.userId

  // Validate the order target server-side (never price a client-supplied slug/plan blindly).
  const ALLOWED_PLANS = new Set(["per-lab", "monthly"]);
  const ALLOWED_CCY = new Set(["INR", "USD"]);
  if (!body.plan || !ALLOWED_PLANS.has(body.plan)) {
    return NextResponse.json({ error: "invalid plan" }, { status: 400 });
  }
  const currency = body.currency ?? "INR";
  if (!ALLOWED_CCY.has(currency)) {
    return NextResponse.json({ error: "invalid currency" }, { status: 400 });
  }
  let canonicalSlug: string | null = null;
  if (body.plan === "per-lab") {
    const l = body.labSlug ? getLab(body.labSlug) : undefined;
    if (!l || l.free || !l.ready) {
      return NextResponse.json({ error: "invalid lab" }, { status: 400 });
    }
    canonicalSlug = l.slug; // #17: pin to the validated lab object, never the raw client string
  }
  const amountMinor = priceFor(canonicalSlug, body.plan, currency);

  // Persist the order (status forced "created" engine-side). This record — not any
  // client value — is what the grant is validated + derived from.
  const orderId = "order_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const order: Order = {
    id: orderId,
    userId,
    labSlug: canonicalSlug,
    plan: body.plan,
    amountMinor,
    currency,
    status: "created",
    createdAt: new Date().toISOString(),
  };
  await createOrder(order);

  // Ask Paytm to initiate the transaction → txnToken for the JS checkout.
  const cfg = paytmConfig();
  if (!cfg.mid || !cfg.key) {
    return NextResponse.json({ error: "payment config missing" }, { status: 503 });
  }
  const origin = new URL(req.url).origin;
  const init = await initiateTransaction({
    orderId,
    amountMinor,
    currency,
    custId: userId,
    callbackUrl: `${origin}/api/payments/paytm/callback?orderId=${encodeURIComponent(orderId)}`,
  });
  if (!init.ok || !init.txnToken) {
    return NextResponse.json({ error: "could not start payment", detail: init.error }, { status: 502 });
  }

  // MID + host are public (used in the checkout JS URL); the merchant key is NOT returned.
  return NextResponse.json({
    orderId,
    labSlug: canonicalSlug, // #17: echo the canonical, server-chosen slug so the client confirms the target
    txnToken: init.txnToken,
    mid: cfg.mid,
    host: cfg.baseUrl,
    amountMinor,
    currency,
  });
}
