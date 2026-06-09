// Server-only Amazon Cognito integration: Hosted UI + Authorization-Code flow,
// JWT verification (jose/JWKS), and our own signed session cookie.
//
// Two trust paths, kept separate:
//   - This file authenticates the END USER to the app (Google / LinkedIn).
//   - AWS console access to a leased lab is brokered by the engine via STS.
//
// Falls back gracefully: if the env vars aren't set, COGNITO_ENABLED is false
// and the app keeps using the local mock (see lib/auth/context.tsx).

import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

const REGION = process.env.COGNITO_REGION ?? "us-east-1";
const DOMAIN = process.env.COGNITO_DOMAIN ?? ""; // shieldsync-labs.auth.us-east-1.amazoncognito.com
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.COGNITO_CLIENT_SECRET ?? "";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:3001";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "";

export const COGNITO_ENABLED = Boolean(DOMAIN && CLIENT_ID && CLIENT_SECRET && USER_POOL_ID && SESSION_SECRET);

export const REDIRECT_URI = `${APP_URL}/api/auth/callback`;
export const SESSION_COOKIE = "ss_session";
export const STATE_COOKIE = "ss_oauth_state";

// Our provider id -> the IdP name as configured in the Cognito App client.
// IMPORTANT: the LinkedIn OIDC provider must be named exactly "LinkedInOIDC"
// in Cognito (or change it here).
const PROVIDER_IDP: Record<string, string> = { google: "Google", linkedin: "LinkedInOIDC" };

function normDomain(d: string): string {
  return d.startsWith("http") ? d.replace(/\/$/, "") : `https://${d}`;
}

export function authorizeUrl(provider: string, state: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    state,
  });
  const idp = PROVIDER_IDP[provider];
  if (idp) p.set("identity_provider", idp); // go straight to Google/LinkedIn, skip the chooser
  return `${normDomain(DOMAIN)}/oauth2/authorize?${p.toString()}`;
}

export function logoutUrl(): string {
  const p = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: `${APP_URL}/` });
  return `${normDomain(DOMAIN)}/logout?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ id_token: string; access_token: string }> {
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`); // confidential client
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
  });
  const r = await fetch(`${normDomain(DOMAIN)}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body,
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { id_token: string; access_token: string };
}

const issuer = (): string => `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`));
  return _jwks;
}

export async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(idToken, jwks(), { issuer: issuer(), audience: CLIENT_ID });
  return payload;
}

/** Infer our provider id from the Cognito username prefix (Google_…, LinkedInOIDC_…). */
export function providerFromClaims(payload: JWTPayload): "google" | "linkedin" {
  const username = String((payload as Record<string, unknown>)["cognito:username"] ?? "");
  return /linkedin/i.test(username) ? "linkedin" : "google";
}

// ---- our session cookie: a short signed JWT we issue and verify ourselves ----

const KEY = new TextEncoder().encode(SESSION_SECRET);

export type SessionUser = { id: string; email: string; name: string; provider: string };

export async function makeSession(u: SessionUser): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name, provider: u.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(KEY);
}

export async function readSession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, KEY);
    return {
      id: String(payload.sub ?? ""),
      email: String((payload as Record<string, unknown>).email ?? ""),
      name: String((payload as Record<string, unknown>).name ?? ""),
      provider: String((payload as Record<string, unknown>).provider ?? ""),
    };
  } catch {
    return null;
  }
}
