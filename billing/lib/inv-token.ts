import "server-only";
// Verify-only — billing portal never issues tokens, only reads them.
// Must use the same key as hr/lib/server/inv-token.ts (same HR_SESSION_SECRET).
import { jwtVerify } from "jose";

const ALG = "HS256";
const AUD = "ss-inv";

function secretKey(): Uint8Array {
  const s = process.env.HR_SESSION_SECRET;
  if (s && s.length > 0) return new TextEncoder().encode(s + ":inv");
  if (process.env.NODE_ENV === "production") throw new Error("HR_SESSION_SECRET not set");
  return new TextEncoder().encode("dev-only-inv-secret");
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
