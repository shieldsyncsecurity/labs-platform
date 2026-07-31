import { NextResponse, type NextRequest } from "next/server";
import { HR_COOKIE, isAdminEmail, verifyHrSession } from "@/lib/server/hr-token";
import { SELF_COOKIE, verifySelfSession } from "@/lib/server/self-token";
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
// the self-serve document viewer (/my/* + /api/self/*), and the logo. Everything
// else — pages, /api/*, and the /sealed/* signature+seal images (forgery
// primitives; wrangler's run_worker_first routes them through the Worker instead
// of the CDN) — requires a valid HR session. API routes get a 401 JSON (not an
// HTML redirect) and still self-gate with getHrActor() as defense in depth.
//
// THE QUESTIONNAIRE HOLE, deliberately scoped: candidates cannot log in, so
// /q/<token> is reachable without a session. It is safe only because the token
// is 192-bit random, expiring, bound to ONE candidate, and the route can do
// exactly two things — read that candidate's name/role and write their answers
// once. It never exposes the portal, other candidates, or employee data. The
// CSRF origin check below still applies to its POST.
//
// THE SELF-SERVE HOLE, same shape: ex-employees have no HR login either, so
// /my/* and /api/self/* are reachable without an ss_hr session. Safety comes
// from a FOURTH, independent auth boundary (ss_self, lib/server/self-token.ts)
// that every /my/* page checks itself — it verifies a completely different
// JWT audience/secret than ss_hr, so nothing here can ever escalate into HR
// access. Identity is proven at /my/login via Employee ID + PIN (rate-limited,
// locked after 5 bad attempts — see /hr/self/login), and once signed in the
// session carries only a seq, scoping every fetch to that one person's own
// issued documents. It exposes nothing else — no other employee, no HR
// dashboard, no write capability at all.
//
// CSRF: SameSite=Lax stops cross-site posts, but sibling *.shieldsyncsecurity.com
// apps are same-SITE — so every state-changing /api request must also originate
// from THIS origin (Origin header when present, else Sec-Fetch-Site).
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Root layout.tsx reads x-pathname (via next/headers) to decide whether to
  // render the internal admin TopNav. Self-serve visitors (Yachna et al.) must
  // NEVER see it — not the module names (Recruiting/Payroll/Governance/
  // Access), not "Sign out" tied to a session that isn't theirs — regardless
  // of whatever OTHER cookies happen to be in that browser (e.g. an admin
  // testing /my in the same profile they're signed into the portal with).
  // MUST be set on the REQUEST headers (not the response) — that's what
  // next/headers' headers() surfaces to Server Components downstream.
  const next = () => {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  const isApi = pathname.startsWith("/api/");
  if (pathname.startsWith("/api/auth/")) return next();
  if (pathname === "/login") return next();

  // Candidate questionnaire: token-authenticated, not session-authenticated.
  const isQuestionnaire = pathname.startsWith("/q/") || pathname.startsWith("/api/q/");
  // Self-serve document viewer: ss_self-authenticated, not ss_hr-authenticated
  // (see THE SELF-SERVE HOLE above). /my/login and /api/self/login are the
  // unauthenticated entry points; /my and /my/doc/* check getSelfSession()
  // themselves and redirect to /my/login on failure.
  const isSelfServe = pathname.startsWith("/my/") || pathname === "/my" || pathname.startsWith("/api/self/");
  // Offer-acceptance acknowledgment: unguessable genId in the URL is the only
  // credential, same trust model as the questionnaire token above — it can
  // only read/accept that ONE issued document, nothing else.
  const isAccept = pathname.startsWith("/accept/") || pathname.startsWith("/api/accept/");
  // Public invoice view: signed JWT encodes invId; client can view that one invoice,
  // nothing else. Same trust model as the questionnaire token.
  const isPublicInvoice = pathname.startsWith("/inv/");

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

  if (isQuestionnaire || isSelfServe || isAccept || isPublicInvoice) return next();

  const token = req.cookies.get(HR_COOKIE)?.value;
  const session = token ? await verifyHrSession(token) : null;

  // The signature and company seal are forgery primitives, so they stay behind
  // a session — but a self-serve visitor holds ss_self, NOT ss_hr. Without this,
  // an ex-employee opening her own appointment letter or payslip sees it with
  // the signature and seal missing, and (worse, silently) the server-side PDF
  // followed the 307 to /login and base64-embedded that HTML as the signature
  // image. A valid ss_self session is sufficient for these two assets: it
  // proves an identity, and grants nothing else anywhere in the portal.
  if (!session && pathname.startsWith("/sealed/")) {
    const selfToken = req.cookies.get(SELF_COOKIE)?.value;
    if (selfToken && (await verifySelfSession(selfToken))) return next();
  }

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
  if (need.kind === "public" || need.kind === "any") return next();

  // The owner is identified by deployment config, so this costs no I/O and can
  // never be revoked by anything stored in the data plane.
  if (isAdminEmail(session.email)) return next();
  if (need.kind === "admin") return deny(req, isApi, "admin");

  // Administrator-only records: for everyone else, a restricted employee's
  // pages and APIs don't 403 — they don't exist. (The list page separately
  // drops the row, so nothing ever links here for them anyway.)
  const seqMatch = pathname.match(/^\/(?:api\/)?employees\/(\d+)(?:\/|$)/);
  if (seqMatch && (await isRestrictedSeq(Number(seqMatch[1])))) {
    if (isApi) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const url = req.nextUrl.clone();
    url.pathname = "/employees";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const access = await grantsFor(session.email);
  if (need.alsoSeeSalary && !access.seeSalary) return deny(req, isApi, "salary");
  if (can(access, need.area, need.need)) return next();
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
let grantCache: { at: number; grants: Record<string, unknown>; restrictedSeqs: number[] } | null = null;

async function accessState(): Promise<{ grants: Record<string, unknown>; restrictedSeqs: number[] }> {
  const now = Date.now();
  if (!grantCache || now - grantCache.at > GRANT_TTL_MS) {
    const { grants, restrictedSeqs } = await hrFetch<{ grants?: Record<string, unknown>; restrictedSeqs?: number[] }>("/hr/access");
    grantCache = { at: now, grants: grants ?? {}, restrictedSeqs: restrictedSeqs ?? [] };
  }
  return grantCache;
}

async function grantsFor(email: string | undefined): Promise<Access> {
  const empty = normalizeAccess(null);
  if (!email) return empty;
  try {
    return normalizeAccess((await accessState()).grants[email.trim().toLowerCase()]);
  } catch {
    // The store being unreachable must never widen access.
    return empty;
  }
}

/** Is this seq restricted, for a non-admin viewer? An unreachable store fails
 * CLOSED to "yes, restricted" — better a record briefly missing for staff than
 * a founder-only record briefly visible. */
async function isRestrictedSeq(seq: number): Promise<boolean> {
  try {
    return (await accessState()).restrictedSeqs.includes(seq);
  } catch {
    return true;
  }
}

export const config = {
  // Skip Next internals + the PUBLIC logo + favicon. /sealed/* is deliberately
  // NOT excluded — the signature and company seal require an authenticated
  // session (same-origin <img> requests carry the cookie automatically).
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico|icon).*)"],
};
