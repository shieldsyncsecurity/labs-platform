// Employer-portal session chokepoint. EVERY portal server action / API route
// must call getOrgId() to find out which org the caller may act as -- and
// must NEVER accept an orgId from the request body/query instead. This file
// is the only place that is allowed to decide "who is signed in" for the
// portal; if that decision is ever wrong, an employer could see another
// employer's candidates and report links, so keep this module small and
// boring.
//
// TODO: replace dev cookie with Cognito enterprise-pool session (email+password
// +TOTP); orgId comes from the verified session's custom:orgId claim. When
// that lands, getOrgId() should verify a real session token (JWT/Cognito
// session) instead of trusting a plain cookie value, but every CALLER of
// getOrgId() in this app stays the same -- that's the point of centralizing
// it here.

import { cookies } from "next/headers";

const COOKIE_NAME = "ss_ent_org";

// Dev cookie is intentionally NOT signed/encrypted yet -- it is just an org
// id string. It is httpOnly + sameSite=lax so it can't be read or forged by
// simple client-side JS/cross-site form tricks, but it is NOT a substitute
// for real auth. Do not ship this to a world where org ids are guessable
// secrets; today org ids come from ShieldSync-controlled provisioning, not
// from anything an attacker chooses.
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
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Dev-only "login": stamps the org id into the session cookie. Called from
 * app/api/portal/dev-login/route.ts after that route has confirmed (via the
 * engine) that the org actually exists. Never call this with an
 * unvalidated/user-supplied orgId from anywhere else.
 */
export async function setOrgIdCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, orgId, {
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
