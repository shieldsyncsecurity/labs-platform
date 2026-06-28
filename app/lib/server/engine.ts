// Server-only helper for talking to the labs engine (Lambda + API GW).
// Encapsulates:
//   - the URL (env)
//   - the shared-secret header (engine refuses requests without it in prod)
//   - the X-User-Id header (engine uses it for ownership checks on actions)
//
// IMPORTANT: this module must NEVER be imported into client code — it would
// leak ENGINE_SHARED_SECRET into the browser bundle. Always import from server
// components / API routes only (this file has no "use client").

import { getServerUser } from "@/lib/auth/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";
const ENGINE_SHARED_SECRET = process.env.ENGINE_SHARED_SECRET ?? "";

// ── Signed engine identity (audit #2) ────────────────────────────────────────
// Alongside the shared-secret header, attach a short-lived, PATH-BOUND HMAC token
// so the engine derives the caller from a value the app cryptographically asserted
// for THIS user + THIS path + a 2-min expiry — not from a verbatim, spoofable
// X-User-Id header. Web Crypto (not node:crypto) because this bundles into the
// Cloudflare Worker — same reason app/lib/payments/paytm.ts uses crypto.subtle.
const ENGINE_AUTH_TTL_SECONDS = 120; // token lifetime; engine allows a small extra skew
const _te = new TextEncoder();

// Unpadded base64url (URL/header-safe) — must match the engine's Buffer "base64url".
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The engine signs/verifies the PATH ONLY; callers pass paths WITH query strings
// (e.g. "/active?labSlug=x") and event.rawPath has no query — strip it on both sides.
function enginePathOnly(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

// Cache the imported HMAC key, KEYED BY the secret value so a rotation self-invalidates.
let _engineKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function engineHmacKey(secret: string): Promise<CryptoKey> {
  if (!_engineKey || _engineKey.secret !== secret) {
    _engineKey = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        _te.encode(secret) as unknown as BufferSource,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      ),
    };
  }
  return _engineKey.key;
}

/** X-Engine-Auth = b64url(JSON{u,p,exp}) + "." + b64url(HMAC_SHA256(secret, head)). */
async function signEngineAuth(userId: string, path: string, secret: string): Promise<string> {
  const payload = { u: userId || "", p: enginePathOnly(path), exp: Math.floor(Date.now() / 1000) + ENGINE_AUTH_TTL_SECONDS };
  const head = b64url(_te.encode(JSON.stringify(payload)));
  const key = await engineHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, _te.encode(head) as unknown as BufferSource);
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

type Opts = {
  /** HTTP method — default POST. */
  method?: "GET" | "POST";
  /** JSON body for POSTs. */
  body?: unknown;
  /** When true, attach X-User-Id from the verified Cognito session. */
  withUser?: boolean;
  /** Override the user id (used by anonymous flows like local dev). */
  userId?: string | null;
  /** Client IP (Cloudflare CF-Connecting-IP) → engine abuse guards (hashed there). */
  ip?: string | null;
  /** Pass through to fetch() — e.g. cache: "no-store" for polls. */
  cache?: RequestCache;
};

export async function engineFetch(path: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Read at request time (Workers inject env per-request — mirrors cognito.ts cfg()).
  const secret = process.env.ENGINE_SHARED_SECRET ?? ENGINE_SHARED_SECRET ?? "";
  if (secret) headers["x-engine-token"] = secret;

  let uid: string | null = null;
  if (opts.withUser) {
    const u = await getServerUser();
    uid = opts.userId ?? u?.id ?? null;
  } else if (opts.userId) {
    uid = opts.userId;
  }

  if (uid) {
    headers["x-user-id"] = uid; // backward-compat during rollout; engine ignores it once a valid token is present
    // Signed, path-bound, short-lived identity (audit #2). Signed iff a secret
    // exists (prod, or local dev pointed at the deployed engine); local dev against
    // a secretless engine keeps the plain-header path. In prod the secret is always
    // set, so prod traffic is always signed.
    if (secret) headers["x-engine-auth"] = await signEngineAuth(uid, path, secret);
  }

  if (opts.ip) headers["x-client-ip"] = opts.ip;
  return fetch(`${ENGINE_URL}${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: opts.cache,
  });
}

/** Convenience for the most common "needs signed-in user" call. */
export function engineFetchAsUser(path: string, body?: unknown, init?: Omit<Opts, "withUser" | "body">) {
  return engineFetch(path, { ...init, withUser: true, body });
}
