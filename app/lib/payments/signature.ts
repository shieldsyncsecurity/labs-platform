import crypto from "crypto";

// HMAC-SHA256 signing/verification for INTERNAL dev-simulator order tokens
// (mock-pay route only). The live provider is Paytm, whose flow does not use
// this module — confirmation is server-to-server via the Order Status API.
//
// SECURITY: must come from env. The previous default string was published with
// the source, which would let an attacker who saw the source forge signatures.
// Fail closed in production — if MOCK_PAYMENT_SECRET is missing, sign/verify
// throw rather than silently using a weak key.
const DEV_DEFAULT = "dev-mock-secret-change-in-prod";

function getSecret(): string {
  const s = process.env.MOCK_PAYMENT_SECRET;
  if (s && s.length >= 16) return s;
  // Tolerate the default only in development. Anywhere else (Workers prod
  // included) refuses to sign so a forgeable payload can't be issued.
  if (process.env.NODE_ENV === "production") {
    throw new Error("MOCK_PAYMENT_SECRET is not configured");
  }
  return DEV_DEFAULT;
}

export function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
}

export function verify(payload: string, signature: string): boolean {
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false; // unconfigured secret -> verification fails closed
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  // constant-time compare; length guard avoids timingSafeEqual throwing
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
