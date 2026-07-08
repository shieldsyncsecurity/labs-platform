// Signed-session primitive shared by the two enterprise session chokepoints.
// This module owns the ONE cryptographic operation they have in common: an
// HMAC-signed value carrying the identity claims minted after a successful
// Cognito sign-in (see lib/server/cognito.ts).
//
// It deliberately does NOT decide "who is signed in" -- that stays in
// portal-session.ts (employer orgs) and admin-session.ts (ShieldSync staff),
// which remain SEPARATE cookies and SEPARATE trust boundaries. This file only
// signs / verifies the opaque token those two modules store. The two token
// kinds carry different `aud` values (see below), so an employer token can
// never verify as an admin token or vice versa even though both are signed
// with the same key -- the "must never be merged" rule in admin-session.ts
// still holds.
//
// Every process.env read happens at call time (never at module load) so the
// Cloudflare Worker's per-request env bindings are in scope.

import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";

// Namespaced audiences keep the two token kinds cryptographically distinct.
const AUD_ORG = "ss-ent-portal";
const AUD_ADMIN = "ss-ent-admin";

// The HMAC key. In production (Cloudflare Worker) SESSION_SECRET is a Worker
// SECRET and MUST be present -- a missing secret in prod is fatal (fail
// closed), never a silent "no auth". In local dev we fall back to a fixed,
// obviously-insecure key so the app runs without secrets; NODE_ENV gates it so
// that key can never be used in prod.
function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s && s.length > 0) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set");
  }
  return new TextEncoder().encode("dev-only-insecure-session-secret-change-me");
}

export type OrgSession = { orgId: string; sub?: string; email?: string };
export type AdminSession = { sub?: string; email?: string };

export async function signOrgSession(s: OrgSession, ttlSeconds: number): Promise<string> {
  return new SignJWT({ orgId: s.orgId, email: s.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(s.sub ?? s.orgId)
    .setAudience(AUD_ORG)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

export async function signAdminSession(s: AdminSession, ttlSeconds: number): Promise<string> {
  return new SignJWT({ email: s.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(s.sub ?? s.email ?? "admin")
    .setAudience(AUD_ADMIN)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

// verify* return null on ANY failure (bad signature, wrong audience, expired,
// malformed) -- callers must treat null as "not signed in" and never fall
// through to trusting the raw cookie.
export async function verifyOrgSession(token: string): Promise<OrgSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      audience: AUD_ORG,
      algorithms: [ALG],
    });
    const orgId = typeof payload.orgId === "string" ? payload.orgId.trim() : "";
    if (!orgId) return null;
    return {
      orgId,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function verifyAdminSession(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      audience: AUD_ADMIN,
      algorithms: [ALG],
    });
    return {
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}
