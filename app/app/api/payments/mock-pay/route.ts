import { NextResponse } from "next/server";
import { verifyAndFulfill } from "@/lib/payments/fulfill";

// THE SIMULATED GATEWAY. This route does NOT exist in production — there,
// Paytm confirms via /api/payments/paytm/confirm + /paytm/callback.
// The client sends back the signedPayload + signature it received from /checkout,
// along with the payment outcome. We run the exact same verify+fulfill path.
//
// SECURITY: hard-disable in production. The HMAC of the signedPayload prevents
// an attacker from grant-forging without the server's signing key, but we still
// don't want a "mark this payment as paid" button shipped to live customers.
// Set ALLOW_MOCK_PAY=1 in Wrangler vars only for dev / preview environments.
const MOCK_PAY_ALLOWED = process.env.ALLOW_MOCK_PAY === "1";

export async function POST(req: Request) {
  if (!MOCK_PAY_ALLOWED) {
    return NextResponse.json({ status: "disabled" }, { status: 404 });
  }
  const { signedPayload, signature, outcome } = (await req.json().catch(() => ({}))) as {
    signedPayload?: string;
    signature?: string;
    outcome?: "success" | "failure";
  };

  if (outcome !== "success") {
    return NextResponse.json({ status: "failed" }, { status: 402 });
  }
  if (typeof signedPayload !== "string" || typeof signature !== "string") {
    return NextResponse.json({ status: "error", reason: "missing fields" }, { status: 400 });
  }

  const result = await verifyAndFulfill(signedPayload, signature);
  if (!result.ok) {
    return NextResponse.json({ status: "error", reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ status: "paid" });
}
