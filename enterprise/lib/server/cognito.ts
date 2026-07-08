// Server-only Amazon Cognito integration for the ShieldSync Enterprise app:
// Hosted-UI Authorization-Code flow + id_token verification (jose/JWKS).
//
// Trust model: this file authenticates the human (employer user OR ShieldSync
// staff) to THIS app. It issues nothing itself -- the verified claims are
// handed to lib/server/auth-session.ts, which mints our own signed session
// cookie. Employer users carry a `custom:orgId` claim; staff/admin users do
// not (they are matched by email allowlist -- see lib/server/admin-session.ts).
//
// Every process.env read is inside cfg(), called at request time (never at
// module load), so Cloudflare Worker env bindings are available -- they are
// injected per-request, after module initialisation.

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

function cfg() {
  return {
    REGION: process.env.COGNITO_REGION ?? "us-east-1",
    POOL_ID: process.env.COGNITO_POOL_ID ?? "",
    CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? "",
    CLIENT_SECRET: process.env.COGNITO_CLIENT_SECRET ?? "",
    DOMAIN: process.env.COGNITO_DOMAIN ?? "",
    APP_URL: process.env.APP_URL ?? "http://localhost:3002",
  };
}

// Short-lived CSRF/state cookie set at /api/auth/login and consumed at the
// callback. Namespaced to this app so it can't collide with the labs app.
export const STATE_COOKIE = "ss_ent_oauth_state";

// True only when the full Cognito config is present. The login UI + auth
// routes gate on this; when false the app falls back to the dev sign-in.
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

// UTF-8-safe base64 for the HTTP Basic header. Plain btoa() throws on any
// character > U+00FF, so a stray non-ASCII byte in the client secret would
// crash the token exchange ("btoa can only operate on Latin1") instead of
// failing auth cleanly. Encode to bytes first, then base64 the binary string.
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Hosted-UI authorize URL. We do NOT pin identity_provider -- the Hosted UI
// presents whatever the pool is configured for (username/password and any
// federated IdPs). scope openid gives us the id_token we verify below.
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

// Hosted-UI logout. logout_uri must EXACTLY match an allowed sign-out URL on
// the app client -- ours is APP_URL with no trailing slash, so do NOT append one.
export function logoutUrl(): string {
  const { DOMAIN, CLIENT_ID, APP_URL } = cfg();
  const p = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: APP_URL });
  return `${normDomain(DOMAIN)}/logout?${p.toString()}`;
}

export async function exchangeCode(
  code: string,
): Promise<{ id_token: string; access_token: string }> {
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
  // Never echo the response body -- it can contain token material on success.
  if (!r.ok) throw new Error(`token exchange failed: ${r.status}`);
  return (await r.json()) as { id_token: string; access_token: string };
}

function jwks() {
  const { REGION, POOL_ID } = cfg();
  const issuer = `https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}`;
  // Create per-call -- do NOT cache at module scope. In Cloudflare Workers a
  // module-scoped jose remote JWKS set reused across requests throws
  // "Cannot perform I/O on behalf of a different request" when it refetches
  // the signing keys. jose caches the keys for the life of this object.
  const set = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return { set, issuer };
}

// SECURITY: verify the id_token SIGNATURE against the pool JWKS, plus issuer,
// audience (our client id) and expiry. A token that fails any check throws --
// callers must treat a throw as "auth failed" and never fall through to
// trusting unsigned claims. token_use must be "id" (not an access token).
export async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  const { set, issuer } = jwks();
  const { payload } = await jwtVerify(idToken, set, {
    issuer,
    audience: cfg().CLIENT_ID,
  });
  if (payload["token_use"] !== "id") {
    throw new Error("unexpected token_use");
  }
  return payload;
}
