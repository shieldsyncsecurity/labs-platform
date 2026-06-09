import { NextResponse } from "next/server";
import { saveOrder } from "@/lib/server/store";
import { priceFor } from "@/lib/payments/pricing";
import type { CheckoutRequest, Order } from "@/lib/payments/types";

// Creates a server-side order (price computed here, never trusted from the
// client). In prod this also creates the Razorpay/Stripe order and returns its
// id + key for the client checkout widget.
export async function POST(req: Request) {
  const body = (await req.json()) as CheckoutRequest;
  if (!body.userId || !body.plan) {
    return NextResponse.json({ error: "missing userId or plan" }, { status: 400 });
  }
  const currency = body.currency ?? "INR";
  const amountMinor = priceFor(body.labSlug ?? null, body.plan, currency);

  const order: Order = {
    id: "order_" + Math.random().toString(36).slice(2, 12),
    userId: body.userId,
    labSlug: body.labSlug ?? null,
    plan: body.plan,
    amountMinor,
    currency,
    status: "created",
    createdAt: new Date().toISOString(),
  };
  saveOrder(order);

  return NextResponse.json({ orderId: order.id, amountMinor, currency });
}
