// Server-only Amazon Cognito integration for the HR portal: Hosted-UI
// Authorization-Code flow + id_token verification (jose/JWKS). Mirrors the
// enterprise app's lib/server/cognito.ts and REUSES the same pool/app-client
// (GO-LIVE: add this app's callback + sign-out URLs to that client).
//
// This file only authenticates the human to THIS app; the verified claims are
// handed to the callback route, which checks the HR allowlist and mints our own
// signed `ss_hr` cookie (see hr-session.ts). Every process.env read is at
// request time so Cloudflare Worker env bindings are in scope.

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

function cfg() {
  return {
    REGION: process.env.COGNITO_REGION ?? "us-east-1",
    POOL_ID: process.env.COGNITO_POOL_ID ?? "",
    CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? "",
    CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET ?? "",
    DOMAIN: process.env.COGNITO_DOMAIN ?? "",
    APP_URL: process.env.APP_URL ?? "http://localhost:3003",
  };
}

// Short-lived CSRF/state cookie, namespaced to THIS app so it can't collide
// with the enterprise app's state cookie.
export const STATE_COOKIE = "ss_hr_oauth_state";

/** True only when the full Cognito config is present; else the app falls back
 * to the dev sign-in (local only). */
export function cognitoEnabled(): boolean {
  const c = cfg();
  return Boolean(c.DOMAIN && c.CLIENT_ID && c.CLIENT_SECRET && c.POOL_ID);
}

export function redirectUri(): string {
  return `${cfg().APP_URL}/api/auth/callback`;
}

function normDomain(d: string): string {
  return d.startsWith("http") ? d.replace(/\/$/, "") : `https://${d}`;
}

// UTF-8-safe base64 for the HTTP Basic header (btoa throws on bytes > U+00FF).
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function authorizeUrl(state: string): string {
  const { DOMAIN, CLIENT_ID } = cfg();
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
  });
  return `${normDomain(DOMAIN)}/oauth2/authorize?${p.toString()}`;
}

// logout_uri must EXACTLY match an allowed sign-out URL on the app client — ours
// is APP_URL with no trailing slash.
export function logoutUrl(): string {
  const { DOMAIN, CLIENT_ID, APP_URL } = cfg();
  const p = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: APP_URL });
  return `${normDomain(DOMAIN)}/logout?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ id_token: string; access_token: string }> {
  const { DOMAIN, CLIENT_ID, CLIENT_SECRET } = cfg();
  const basic = basicAuth(CLIENT_ID, CLIENT_SECRET);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri(),
  });
  const r = await fetch(`${normDomain(DOMAIN)}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${basic}`,
    },
    body,
  });
  // Never echo the response body — it can contain token material on success.
  if (!r.ok) throw new Error(`token exchange failed: ${r.status}`);
  return (await r.json()) as { id_token: string; access_token: string };
}

function jwks() {
  const { REGION, POOL_ID } = cfg();
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
  // Create per-call — a module-scoped jose remote JWKS set reused across
  // requests throws "Cannot perform I/O on behalf of a different request" in
  // Cloudflare Workers when it refetches signing keys.
  const set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return { set, issuer };
}

// Verify id_token signature (pool JWKS) + issuer + audience + expiry. A token
// that fails any check throws; callers must treat a throw as "auth failed".
export async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  const { set, issuer } = jwks();
  const { payload } = await jwtVerify(idToken, set, { issuer, audience: cfg().CLIENT_ID });
  if (payload["token_use"] !== "id") {
    throw new Error("unexpected token_use");
  }
  return payload;
}
