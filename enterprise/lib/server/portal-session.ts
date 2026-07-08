// Employer-portal session chokepoint. EVERY portal server action / API route
// must call getOrgId() to find out which org the caller may act as -- and
// must NEVER accept an orgId from the request body/query instead. This file
// is the only place that is allowed to decide "who is signed in" for the
// portal; if that decision is ever wrong, an employer could see another
// employer's candidates and report links, so keep this module small and
// boring.
//
// The cookie now holds an HMAC-SIGNED session token (see auth-session.ts)
// minted after a verified Cognito sign-in -- getOrgId() verifies the signature
// and pulls the orgId from the trusted claims, so a tampered/forged cookie
// value is rejected. Every CALLER of getOrgId() stays unchanged -- that's the
// point of centralizing it here. (setOrgIdCookie is still called by the
// temporary dev-login route; it too now issues a signed token.)

import { cookies } from "next/headers";
import { signOrgSession, verifyOrgSession } from "./auth-session";

const COOKIE_NAME = "ss_ent_org";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Returns the signed-in employer's orgId, or null if there is no portal
 * session. Server-only (reads httpOnly cookies via next/headers).
 *
 * This is the SINGLE place portal code should ask "which org is this?" --
 * every portal page / server action / API route must call this and use
 * ONLY this value as the orgId passed to the engine. Never read orgId from
 * a request body, query string, or form field.
 */
export async function getOrgId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const session = await verifyOrgSession(value);
  return session?.orgId ?? null;
}

/**
 * Stamps a signed employer session into the cookie. Called by the Cognito
 * callback (app/api/auth/callback) with the orgId taken from the verified
 * `custom:orgId` claim, and by the temporary dev-login route after it has
 * confirmed (via the engine) that the org exists. Never call this with an
 * unvalidated/user-supplied orgId from anywhere else.
 */
export async function setOrgIdCookie(
  orgId: string,
  extra?: { sub?: string; email?: string },
): Promise<void> {
  const token = await signOrgSession(
    { orgId, sub: extra?.sub, email: extra?.email },
    COOKIE_MAX_AGE_SECONDS,
  );
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/** Signs the employer out of the portal by clearing the session cookie. */
export async function clearOrgId(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
