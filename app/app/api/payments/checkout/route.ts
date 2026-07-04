import { NextResponse } from "next/server";
import { priceFor } from "@/lib/payments/pricing";
import { getServerUser } from "@/lib/auth/session";
import { getLab } from "@/lib/labs";
import { createOrder } from "@/lib/server/orders";
import { initiateTransaction, paytmConfig, paymentsEnabled } from "@/lib/payments/paytm";
import type { CheckoutRequest, Order } from "@/lib/payments/types";

export async function POST(req: Request) {
  try {
    // Read at request time — Workers inject env per-request, module-level reads fire
    // before the Worker env is fully populated and can evaluate to "". Requires BOTH
    // PAYMENTS_LIVE=1 and PAYTM_ENV=production, so a staging gateway can never be hit
    // by a real user even if the master switch is flipped early.
    if (!paymentsEnabled()) {
      return NextResponse.json({ error: "payments not available yet" }, { status: 503 });
    }

    const sessionUser = await getServerUser();
    if (!sessionUser?.id) {
      return NextResponse.json({ error: "sign in required" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as CheckoutRequest;
    const userId = sessionUser.id;

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
      canonicalSlug = l.slug;
    }
    const amountMinor = priceFor(canonicalSlug, body.plan, currency);

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

    const cfg = paytmConfig();
    if (!cfg.mid || !cfg.key) {
      return NextResponse.json({ error: "payment config missing — PAYTM_MID or PAYTM_MERCHANT_KEY not set" }, { status: 503 });
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
      return NextResponse.json({ error: "could not start payment", detail: init.error, raw: init.raw }, { status: 502 });
    }

    return NextResponse.json({
      orderId,
      labSlug: canonicalSlug,
      txnToken: init.txnToken,
      mid: cfg.mid,
      host: cfg.baseUrl,
      amountMinor,
      currency,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("checkout route unhandled error:", msg);
    return NextResponse.json({ error: `checkout error: ${msg}` }, { status: 500 });
  }
}
