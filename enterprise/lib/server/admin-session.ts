// ShieldSync-STAFF admin session chokepoint. This is a SEPARATE gate from
// lib/server/portal-session.ts on purpose: portal sessions answer "which
// employer org is this?" for employer users, while this file answers a
// completely different question -- "is this ShieldSync staff (Himanshu),
// allowed to see/manage EVERY org?" Those two trust boundaries must never be
// merged into one cookie/one check, or an employer session could accidentally
// unlock admin actions (or vice versa).
//
// The cookie now holds an HMAC-SIGNED admin session token (see auth-session.ts)
// carrying a DISTINCT audience from the employer token, so an employer session
// can never verify here (and vice versa) even though both are signed with the
// same key -- the "must never be merged" rule above still holds. Staff identity
// is established two ways, both of which mint this cookie: the Cognito callback
// (email in ADMIN_EMAILS) and the legacy shared-secret form
// (app/api/admin/login, ADMIN_PANEL_SECRET). Every CALLER of getAdminSession()
// stays unchanged; that's the point of centralizing it here.

import { cookies } from "next/headers";
import { signAdminSession, verifyAdminSession } from "./auth-session";

const COOKIE_NAME = "ss_ent_admin";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours -- staff session, short-lived on purpose.

/**
 * Returns true if the caller has an active ShieldSync-staff admin session,
 * false otherwise. Server-only (reads httpOnly cookies via next/headers).
 *
 * This is the SINGLE place admin code should ask "is this an authenticated
 * admin?" -- every admin page / API route must call this FIRST and bail out
 * (redirect or 401) when it returns false. Never infer admin-ness from
 * anything else (query params, referrer, portal session, etc).
 */
export async function getAdminSession(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  if (!value) return false;
  return (await verifyAdminSession(value)) !== null;
}

/**
 * Audit identity for admin MUTATIONS (E9): the staff email carried in the
 * signed session (Cognito path), or the fixed marker "secret-admin" for a
 * session minted by the legacy ADMIN_PANEL_SECRET form (which has no email).
 * Returns null when there is NO valid admin session -- callers may use this
 * as their fail-closed gate (`if (!actor) return 401`), which is exactly
 * equivalent to getAdminSession() returning false. getAdminSession() keeps
 * its boolean contract for every existing caller; this is additive only.
 */
export async function getAdminActor(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_NAME)?.value;
  if (!value) return null;
  const session = await verifyAdminSession(value);
  if (!session) return null;
  const email = session.email?.trim();
  return email && email.length > 0 ? email : "secret-admin";
}

/**
 * Stamps a signed admin session cookie. Called by the Cognito callback
 * (app/api/auth/callback, for an email in ADMIN_EMAILS) and by the legacy
 * shared-secret route (app/api/admin/login, after a constant-time check
 * against ADMIN_PANEL_SECRET). Never call this from anywhere else.
 */
export async function setAdminCookie(extra?: { sub?: string; email?: string }): Promise<void> {
  const token = await signAdminSession(
    { sub: extra?.sub, email: extra?.email },
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

/** Signs the staff admin out by clearing the session cookie. */
export async function clearAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
