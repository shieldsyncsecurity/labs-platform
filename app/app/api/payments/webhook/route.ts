import { NextResponse } from "next/server";
import { verifyAndFulfill } from "@/lib/payments/fulfill";

// REAL PROVIDER WEBHOOK (Razorpay / Stripe) — the production payment confirmation
// path. The mock doesn't use it, but it's here so going live is a small change:
//   - Razorpay: signature in the `x-razorpay-signature` header, HMAC-SHA256 of
//     the RAW body with the dashboard webhook secret. Map Razorpay's event shape
//     ({ payload.payment.entity.notes.orderId, ... }) to our { orderId } before
//     fulfilling, and point verify() at RAZORPAY_WEBHOOK_SECRET.
//   - Always read the RAW body (req.text()) — parsing first breaks signatures.
export async function POST(req: Request) {
  const raw = await req.text();
  const signature =
    req.headers.get("x-razorpay-signature") ?? req.headers.get("x-signature") ?? "";

  const result = await verifyAndFulfill(raw, signature);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
