// Shareable invoice tokens — a signed JWT that encodes only the invId.
// No login required to view: the token IS the credential.
// Same pattern as the candidate questionnaire token (hr-token.ts), using a
// distinct audience ("ss-inv") so it can never be misused as an HR session.
import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const AUD = "ss-inv";
const TTL_SECONDS = 365 * 24 * 3600; // 1 year — invoice links are long-lived

function secretKey(): Uint8Array {
  const s = process.env.HR_SESSION_SECRET;
  if (s && s.length > 0) return new TextEncoder().encode(s + ":inv");
  if (process.env.NODE_ENV === "production") throw new Error("HR_SESSION_SECRET not set");
  return new TextEncoder().encode("dev-only-inv-secret");
}

export async function signInvoiceToken(invId: string): Promise<string> {
  return new SignJWT({ invId })
    .setProtectedHeader({ alg: ALG })
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifyInvoiceToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: AUD });
    const invId = payload.invId;
    return typeof invId === "string" ? invId : null;
  } catch {
    return null;
  }
}
