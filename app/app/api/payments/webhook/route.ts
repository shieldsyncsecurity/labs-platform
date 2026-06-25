import { NextResponse } from "next/server";
import { verifyAndFulfill } from "@/lib/payments/fulfill";

// REAL PROVIDER WEBHOOK — the production payment-confirmation (entitlement-grant)
// path. HARD-DISABLED until payments are actually live (PAYMENTS_LIVE=1).
//
// ⚠️ SECURITY: this route grants entitlements. It MUST NOT be reachable until it
// verifies the REAL provider's signature against a SERVER-PERSISTED order (status
// paid, matching amount, idempotency). The current verifyAndFulfill() only checks
// an internally-signed, client-replayable payload — leaving it live = a payment
// bypass (anyone could self-grant all-access). So it stays 404 in prod until the
// Paytm wiring lands (which will add: real Paytm checksum verification + order
// persistence + amount/idempotency checks). Do NOT set PAYMENTS_LIVE=1 before then.
const PAYMENTS_LIVE = process.env.PAYMENTS_LIVE === "1";

export async function POST(req: Request) {
  if (!PAYMENTS_LIVE) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Always read the RAW body (req.text()) — parsing first breaks signatures.
  const raw = await req.text();
  const signature =
    req.headers.get("x-razorpay-signature") ?? req.headers.get("x-signature") ?? "";

  const result = await verifyAndFulfill(raw, signature);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
