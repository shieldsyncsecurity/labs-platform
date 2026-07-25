import { NextResponse, type NextRequest } from "next/server";
import { HR_COOKIE, isAdminEmail, verifyHrSession } from "@/lib/server/hr-token";
import { hrFetch } from "@/lib/server/hr-engine";
import { requirementFor } from "@/lib/access-routes";
import { can, normalizeAccess, type Access } from "@/lib/access";

// NOTE: this file is `middleware.ts`, not Next 16's newer `proxy.ts` —
// deliberately. `proxy.ts` is HARD-LOCKED to the Node.js runtime (Next
// refuses a `runtime` override there: "Proxy always runs on Node.js
// runtime"), and Cloudflare Workers via @opennextjs/cloudflare 1.20.1 does
// not support Node.js middleware at all — `cf:deploy` fails outright. The
// older `middleware.ts` convention still works in Next 16 and defaults to
// the Edge runtime, which IS supported. Revisit once opennextjs-cloudflare
// adds Node-middleware support; until then, do not rename this to proxy.ts.

// Deny-by-default gate for the whole portal (Next 16 "proxy"). Public surface is
// EXACTLY: /login, /api/auth/*, the candidate questionnaire (/q/* + /api/q/*),
// and the logo. Everything else — pages, /api/*, and the /sealed/* signature+seal
// images (forgery primitives; wrangler's run_worker_first routes them through the
// Worker instead of the CDN) — requires a valid HR session. API routes get a 401
// JSON (not an HTML redirect) and still self-gate with getHrActor() as defense
// in depth.
//
// THE QUESTIONNAIRE HOLE, deliberately scoped: candidates cannot log in, so
// /q/<token> is reachable without a session. It is safe only because the token
// is 192-bit random, expiring, bound to ONE candidate, and the route can do
// exactly two things — read that candidate's name/role and write their answers
// once. It never exposes the portal, other candidates, or employee data. The
// CSRF origin check below still applies to its POST.
//
// CSRF: SameSite=Lax stops cross-site posts, but sibling *.shieldsyncsecurity.com
// apps are same-SITE — so every state-changing /api request must also originate
// from THIS origin (Origin header when present, else Sec-Fetch-Site).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isApi = pathname.startsWith("/api/");
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (pathname === "/login") return NextResponse.next();

  // Candidate questionnaire: token-authenticated, not session-authenticated.
  const isQuestionnaire = pathname.startsWith("/q/") || pathname.startsWith("/api/q/");

  // Cross-origin write protection for state-changing API calls.
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const secFetchSite = req.headers.get("sec-fetch-site");
    const selfOrigin = req.nextUrl.origin;
    const crossOrigin = origin ? origin !== selfOrigin : secFetchSite === "cross-site" || secFetchSite === "same-site";
    if (crossOrigin) {
      return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
    }
  }

  if (isQuestionnaire) return NextResponse.next();

  const token = req.cookies.get(HR_COOKIE)?.value;
  const session = token ? await verifyHrSession(token) : null;

  if (!session) {
    if (isApi) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    return NextResponse.redirect(url);
  }

  // ---- Authorisation ----------------------------------------------------
  // Signed in is not the same as allowed. Every surface resolves to a required
  // permission here, and anything unmapped is administrator-only, so a new page
  // added later is denied by default rather than silently exposed.
  const need = requirementFor(pathname, req.method);
  if (need.kind === "public" || need.kind === "any") return NextResponse.next();

  // The owner is identified by deployment config, so this costs no I/O and can
  // never be revoked by anything stored in the data plane.
  if (isAdminEmail(session.email)) return NextResponse.next();
  if (need.kind === "admin") return deny(req, isApi, "admin");

  const access = await grantsFor(session.email);
  if (can(access, need.area, need.need)) return NextResponse.next();
  return deny(req, isApi, need.area);
}

function deny(req: NextRequest, isApi: boolean, area: string) {
  if (isApi) {
    return NextResponse.json(
      { error: "You do not have access to this. Ask the administrator if you need it." },
      { status: 403 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/no-access";
  url.search = `?area=${encodeURIComponent(area)}`;
  return NextResponse.redirect(url);
}

// Permissions are read from the data plane rather than baked into the session
// cookie: cookie-embedded permissions would only change at the next sign-in, up
// to 12 hours later, and "I revoked banking" has to mean now. The short TTL
// below keeps that honest while avoiding a round trip on every asset request —
// a revocation lands within seconds, not hours.
const GRANT_TTL_MS = 10_000;
let grantCache: { at: number; grants: Record<string, unknown> } | null = null;

async function grantsFor(email: string | undefined): Promise<Access> {
  const empty = normalizeAccess(null);
  if (!email) return empty;
  try {
    const now = Date.now();
    if (!grantCache || now - grantCache.at > GRANT_TTL_MS) {
      const { grants } = await hrFetch<{ grants?: Record<string, unknown> }>("/hr/access");
      grantCache = { at: now, grants: grants ?? {} };
    }
    return normalizeAccess(grantCache.grants[email.trim().toLowerCase()]);
  } catch {
    // The store being unreachable must never widen access.
    return empty;
  }
}

export const config = {
  // Skip Next internals + the PUBLIC logo + favicon. /sealed/* is deliberately
  // NOT excluded — the signature and company seal require an authenticated
  // session (same-origin <img> requests carry the cookie automatically).
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico|icon).*)"],
};
