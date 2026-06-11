// Server-only Amazon Cognito integration: Hosted UI + Authorization-Code flow,
// JWT verification (jose/JWKS), and our own signed session cookie.
//
// Two trust paths, kept separate:
//   - This file authenticates the END USER to the app (Google / LinkedIn).
//   - AWS console access to a leased lab is brokered by the engine via STS.
//
// Falls back gracefully: if the env vars aren't set, COGNITO_ENABLED() is false
// and the app keeps using the local mock (see lib/auth/context.tsx).
//
// All process.env reads are inside cfg() — called at request time, not at
// module load — so Cloudflare Worker env bindings are available (they're
// injected per-request, after module initialisation).

import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

function cfg() {
  return {
    REGION:        process.env.COGNITO_REGION        ?? "us-east-1",
    DOMAIN:        process.env.COGNITO_DOMAIN        ?? "",
    CLIENT_ID:     process.env.COGNITO_CLIENT_ID     ?? "",
    CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET ?? "",
    USER_POOL_ID:  process.env.COGNITO_USER_POOL_ID  ?? "",
    APP_URL:       process.env.APP_URL               ?? "http://localhost:3001",
    SESSION_SECRET:process.env.SESSION_SECRET        ?? "",
  };
}

export function COGNITO_ENABLED(): boolean {
  const c = cfg();
  return Boolean(c.DOMAIN && c.CLIENT_ID && c.CLIENT_SECRET && c.USER_POOL_ID && c.SESSION_SECRET);
}

export function REDIRECT_URI(): string { return `${cfg().APP_URL}/api/auth/callback`; }

export const SESSION_COOKIE = "ss_session";
export const STATE_COOKIE = "ss_oauth_state";

const PROVIDER_IDP: Record<string, string> = { google: "Google", linkedin: "LinkedInOIDC" };

function normDomain(d: string): string {
  return d.startsWith("http") ? d.replace(/\/$/, "") : `https://${d}`;
}

// UTF-8-safe base64 for the HTTP Basic header. Plain btoa() throws on any
// character > U+00FF, so a stray non-ASCII byte in a secret would crash the
// token exchange ("btoa can only operate on Latin1") instead of failing auth
// cleanly. Encode to bytes first, then base64 the binary string.
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function authorizeUrl(provider: string, state: string): string {
  const { DOMAIN, CLIENT_ID } = cfg();
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI(),
    scope: "openid email profile",
    state,
  });
  const idp = PROVIDER_IDP[provider];
  if (idp) p.set("identity_provider", idp);
  return `${normDomain(DOMAIN)}/oauth2/authorize?${p.toString()}`;
}

export function logoutUrl(): string {
  const { DOMAIN, CLIENT_ID, APP_URL } = cfg();
  const p = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: `${APP_URL}/` });
  return `${normDomain(DOMAIN)}/logout?${p.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ id_token: string; access_token: string }> {
  const { DOMAIN, CLIENT_ID, CLIENT_SECRET } = cfg();
  const basic = basicAuth(CLIENT_ID, CLIENT_SECRET);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI(),
  });
  const r = await fetch(`${normDomain(DOMAIN)}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body,
  });
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { id_token: string; access_token: string };
}

function jwks() {
  const { REGION, USER_POOL_ID } = cfg();
  const issuerUrl = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
  // Create per-call — do NOT cache at module scope. In Cloudflare Workers a
  // module-scoped jose remote JWKS set reused across requests throws
  // "Cannot perform I/O on behalf of a different request" when it refetches the
  // signing keys. jose caches the keys internally for the life of this object.
  const set = createRemoteJWKSet(new URL(`${issuerUrl}/.well-known/jwks.json`));
  return { jwks: set, issuerUrl };
}

export async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  const { jwks: j, issuerUrl } = jwks();
  const { payload } = await jwtVerify(idToken, j, { issuer: issuerUrl, audience: cfg().CLIENT_ID });
  return payload;
}

export function providerFromClaims(payload: JWTPayload): "google" | "linkedin" {
  const username = String((payload as Record<string, unknown>)["cognito:username"] ?? "");
  return /linkedin/i.test(username) ? "linkedin" : "google";
}

// ---- our session cookie: a short signed JWT we issue and verify ourselves ----

export type SessionUser = { id: string; email: string; name: string; provider: string };

export async function makeSession(u: SessionUser): Promise<string> {
  const KEY = new TextEncoder().encode(cfg().SESSION_SECRET);
  return new SignJWT({ email: u.email, name: u.name, provider: u.provider })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(KEY);
}

export async function readSession(token: string): Promise<SessionUser | null> {
  try {
    const KEY = new TextEncoder().encode(cfg().SESSION_SECRET);
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
