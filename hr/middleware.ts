import { NextResponse, type NextRequest } from "next/server";
import { HR_COOKIE, verifyHrSession } from "@/lib/server/hr-token";

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
  if (session) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals + the PUBLIC logo + favicon. /sealed/* is deliberately
  // NOT excluded — the signature and company seal require an authenticated
  // session (same-origin <img> requests carry the cookie automatically).
  matcher: ["/((?!_next/static|_next/image|brand/|favicon.ico|icon).*)"],
};
