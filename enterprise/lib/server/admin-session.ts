// ShieldSync-STAFF admin session chokepoint. This is a SEPARATE gate from
// lib/server/portal-session.ts on purpose: portal sessions answer "which
// employer org is this?" for employer users, while this file answers a
// completely different question -- "is this ShieldSync staff (Himanshu),
// allowed to see/manage EVERY org?" Those two trust boundaries must never be
// merged into one cookie/one check, or an employer session could accidentally
// unlock admin actions (or vice versa).
//
// TODO: replace the shared-secret gate below with the Cognito ADMIN group /
// ADMIN_USER_IDS pattern (see labs app/lib/auth/admin.ts, which checks a
// verified Cognito session's `sub` against a comma-separated ADMIN_USER_IDS
// allowlist). When that lands, getAdminSession() should verify a real
// Cognito session and check group/id membership instead of trusting a plain
// cookie value -- but every CALLER of getAdminSession() in this app stays
// the same; that's the point of centralizing it here. Staff auth must stay
// SEPARATE from the employer portal session even after that migration.

import { cookies } from "next/headers";

const COOKIE_NAME = "ss_ent_admin";

// Marker cookie only -- it carries no data, just presence/absence. It is
// httpOnly + sameSite=lax so it can't be read or forged by client-side JS or
// simple cross-site tricks, but (like the portal dev cookie) it is NOT a
// substitute for real auth. It is only ever set by app/api/admin/login/route.ts,
// and only after that route has verified the caller's secret against
// ADMIN_PANEL_SECRET with a constant-time comparison.
const COOKIE_VALUE = "1";
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
  return store.get(COOKIE_NAME)?.value === COOKIE_VALUE;
}

/**
 * Stamps the admin session cookie. Called ONLY from
 * app/api/admin/login/route.ts, and only after that route has confirmed the
 * submitted secret matches process.env.ADMIN_PANEL_SECRET via a
 * constant-time comparison. Never call this from anywhere else.
 */
export async function setAdminCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, COOKIE_VALUE, {
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
