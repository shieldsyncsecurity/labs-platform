// Pure crypto + allowlist for the HR trust boundary. NO next/headers here, so
// this module is safe to import from BOTH Route Handlers and the edge
// middleware (which verifies the cookie on every request).
//
// This is a THIRD, independent trust boundary from the enterprise app's admin
// and portal sessions: its own audience (`ss-hr`), its own signing secret
// (HR_SESSION_SECRET), and its own cookie name (`ss_hr`). An enterprise cookie
// can never verify here and vice versa, even if a secret were ever shared.

import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
const AUD = "ss-hr";
export const HR_COOKIE = "ss_hr";
export const HR_COOKIE_MAX_AGE = 60 * 60 * 12; // 12h — short-lived staff session.

// In production (Cloudflare Worker) HR_SESSION_SECRET is a Worker SECRET and
// MUST be present — a missing secret in prod is fatal (fail closed), never a
// silent "no auth". Local dev falls back to a fixed insecure key, gated by
// NODE_ENV so it can never be used in prod.
function secretKey(): Uint8Array {
  const s = process.env.HR_SESSION_SECRET;
  if (s && s.length > 0) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    throw new Error("HR_SESSION_SECRET is not set");
  }
  return new TextEncoder().encode("dev-only-insecure-hr-session-secret-change-me");
}

export type HrSession = { sub?: string; email?: string };

export async function signHrSession(s: HrSession, ttlSeconds = HR_COOKIE_MAX_AGE): Promise<string> {
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(s.sub ?? s.email ?? "hr")
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

/** Returns the session on success, null on ANY failure (bad sig/aud/expiry). */
export async function verifyHrSession(token: string): Promise<HrSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: AUD, algorithms: [ALG] });
    return {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

/** The exactly-two allowlisted HR emails, lowercased. */
export function hrAllowlist(): Set<string> {
  return new Set(
    (process.env.HR_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowed(email: string): boolean {
  return hrAllowlist().has(email.trim().toLowerCase());
}
