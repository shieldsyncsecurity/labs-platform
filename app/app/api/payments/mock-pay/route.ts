import { NextResponse } from "next/server";
import { sign } from "@/lib/payments/signature";
import { verifyAndFulfill } from "@/lib/payments/fulfill";

// THE SIMULATED GATEWAY. This route does NOT exist in production — there,
// Razorpay/Stripe processes the payment and calls /api/payments/webhook.
// Here we emulate that: on "success" we build a webhook-shaped payload, sign it
// server-side (secret never touches the client), and run the exact same
// verify+fulfill path the real webhook uses.
export async function POST(req: Request) {
  const { orderId, outcome } = (await req.json()) as {
    orderId: string;
    outcome: "success" | "failure";
  };

  if (outcome !== "success") {
    return NextResponse.json({ status: "failed" }, { status: 402 });
  }

  const payload = JSON.stringify({
    orderId,
    paymentId: "pay_" + Math.random().toString(36).slice(2, 12),
  });
  const signature = sign(payload);

  const result = verifyAndFulfill(payload, signature);
  if (!result.ok) {
    return NextResponse.json({ status: "error", reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ status: "paid" });
}
