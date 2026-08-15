// Pure crypto for the SELF-SERVE trust boundary (ex-employees viewing their own
// issued documents at /my). A FOURTH, independent boundary from the enterprise
// app, the HR staff session (ss_hr), and the candidate questionnaire token:
// its own audience (`ss-self`), its own signing secret (SELF_SESSION_SECRET),
// its own cookie (`ss_self`). Deliberately carries NOTHING but a seq — this
// session can never be escalated into HR-portal access because hr-token.ts
// verifies a completely different audience with a completely different key.
//
// Edge-safe (no next/headers) so middleware could verify it directly if a
// future route ever needs to; today only self-session.ts (Route Handlers /
// Server Components) reads it.

import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const AUD = "ss-self";
export const SELF_COOKIE = "ss_self";
export const SELF_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30d — she isn't re-logging in every visit for a certificate.

function secretKey(): Uint8Array {
  const s = process.env.SELF_SESSION_SECRET;
  if (s && s.length > 0) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SELF_SESSION_SECRET is not set");
  }
  return new TextEncoder().encode("dev-only-insecure-self-session-secret-change-me");
}

export type SelfSession = { seq: number };

export async function signSelfSession(s: SelfSession, ttlSeconds = SELF_COOKIE_MAX_AGE): Promise<string> {
  return new SignJWT({ seq: s.seq })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(s.seq))
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

/** Returns the session on success, null on ANY failure (bad sig/aud/expiry). */
export async function verifySelfSession(token: string): Promise<SelfSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: AUD, algorithms: [ALG] });
    const seq = Number(payload.seq);
    return Number.isInteger(seq) && seq > 0 ? { seq } : null;
  } catch {
    return null;
  }
}
