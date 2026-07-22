// Cookie-bound HR session helpers (server components + Route Handlers). Reads/
// writes the httpOnly `ss_hr` cookie via next/headers; the crypto + allowlist
// live in hr-token.ts (edge-safe, imported by middleware too).
//
// getHrSession() is the SINGLE place app code asks "is this an authenticated,
// allowlisted HR user?" — every protected page/route must fail closed on false.

import { cookies } from "next/headers";
import { HR_COOKIE, HR_COOKIE_MAX_AGE, signHrSession, verifyHrSession } from "./hr-token";

/** True iff the caller has a valid HR session cookie. Server-only. */
export async function getHrSession(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(HR_COOKIE)?.value;
  if (!value) return false;
  return (await verifyHrSession(value)) !== null;
}

/**
 * Audit identity for HR mutations: the allowlisted email in the signed session,
 * or null when there is NO valid session. Callers use `if (!actor) return 401`
 * as their fail-closed gate.
 */
export async function getHrActor(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(HR_COOKIE)?.value;
  if (!value) return null;
  const session = await verifyHrSession(value);
  if (!session) return null;
  const email = session.email?.trim();
  return email && email.length > 0 ? email : "hr-user";
}

/** Stamp a signed HR session cookie (Cognito callback / dev-login only). */
export async function setHrCookie(extra?: { sub?: string; email?: string }): Promise<void> {
  const token = await signHrSession({ sub: extra?.sub, email: extra?.email });
  const store = await cookies();
  store.set(HR_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: HR_COOKIE_MAX_AGE,
  });
}

/** Sign the HR user out by clearing the session cookie. */
export async function clearHrSession(): Promise<void> {
  const store = await cookies();
  store.delete(HR_COOKIE);
}
