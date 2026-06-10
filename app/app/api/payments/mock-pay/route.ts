import { NextResponse } from "next/server";
import { verifyAndFulfill } from "@/lib/payments/fulfill";

// THE SIMULATED GATEWAY. This route does NOT exist in production — there,
// Razorpay/Stripe calls /api/payments/webhook.
// The client sends back the signedPayload + signature it received from /checkout,
// along with the payment outcome. We run the exact same verify+fulfill path.
export async function POST(req: Request) {
  const { signedPayload, signature, outcome } = (await req.json()) as {
    signedPayload: string;
    signature: string;
    outcome: "success" | "failure";
  };

  if (outcome !== "success") {
    return NextResponse.json({ status: "failed" }, { status: 402 });
  }

  const result = await verifyAndFulfill(signedPayload, signature);
  if (!result.ok) {
    return NextResponse.json({ status: "error", reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ status: "paid" });
}
