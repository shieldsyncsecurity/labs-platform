import crypto from "crypto";

// HMAC-SHA256 webhook signing/verification — the SAME scheme Razorpay and Stripe
// use. The simulated gateway signs server-side; the real provider will sign with
// its own webhook secret. Only the secret source changes when we go live.
const SECRET = process.env.MOCK_PAYMENT_SECRET ?? "dev-mock-secret-change-in-prod";

export function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function verify(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  // constant-time compare; length guard avoids timingSafeEqual throwing
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
