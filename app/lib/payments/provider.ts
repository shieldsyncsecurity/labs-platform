import crypto from "crypto";

// REAL payment-provider webhook verification — the trust boundary for the
// production /api/payments/webhook route.
//
// This is deliberately SEPARATE from lib/payments/signature.ts. That module
// signs our INTERNAL order tokens with MOCK_PAYMENT_SECRET for the dev
// simulator (mock-pay). The webhook must NOT share that secret: when it did,
// a client could take the token /checkout handed back and replay it straight
// into the webhook to self-grant entitlements (the payment-bypass chain).
//
// The webhook therefore trusts ONLY a signature the real provider produced with
// a secret the client never sees (RAZORPAY_WEBHOOK_SECRET — the Razorpay
// dashboard "webhook secret"). Razorpay signs the EXACT raw request body with
// HMAC-SHA256 and sends it in the X-Razorpay-Signature header.

function getWebhookSecret(): string | null {
  const s = process.env.RAZORPAY_WEBHOOK_SECRET;
  // Require a real secret. Short/empty -> treat as unconfigured (fail closed).
  return s && s.length >= 16 ? s : null;
}

export type ProviderEvent = {
  eventId: string; // provider's event/payment id — used as the idempotency key
  orderId: string; // OUR order id, echoed back by the provider (notes/receipt)
  paymentId: string;
  amountMinor: number;
  currency: string;
  status: "captured" | "failed" | "other";
};

// Returns the parsed event ONLY when the secret is configured AND the signature
// is valid. Fails closed (null) otherwise — so an unconfigured provider can
// never fulfill, and flipping PAYMENTS_LIVE=1 before the real provider is wired
// does not reopen the bypass.
export function verifyProviderWebhook(rawBody: string, signature: string): ProviderEvent | null {
  const secret = getWebhookSecret();
  if (!secret) return null; // not wired yet -> reject everything
  if (!signature) return null;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // constant-time compare; length guard avoids timingSafeEqual throwing
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let evt: {
    id?: string;
    event?: string;
    payload?: { payment?: { entity?: Record<string, unknown> } };
  };
  try {
    evt = JSON.parse(rawBody);
  } catch {
    return null;
  }

  // Razorpay event shape: { id, event, payload: { payment: { entity } } }.
  const payment = evt?.payload?.payment?.entity;
  if (!payment || typeof payment !== "object") return null;

  const notes = payment.notes as Record<string, unknown> | undefined;
  const orderId = (notes?.orderId ?? payment.order_id) as string | undefined;
  if (!orderId) return null;

  const status: ProviderEvent["status"] =
    evt.event === "payment.captured" || payment.status === "captured"
      ? "captured"
      : evt.event === "payment.failed"
        ? "failed"
        : "other";

  return {
    eventId: String(evt.id ?? payment.id ?? ""),
    orderId: String(orderId),
    paymentId: String(payment.id ?? ""),
    amountMinor: Number(payment.amount),
    currency: String(payment.currency ?? "INR"),
    status,
  };
}
