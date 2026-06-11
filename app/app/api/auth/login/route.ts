import { NextResponse } from "next/server";
import { authorizeUrl, COGNITO_ENABLED, STATE_COOKIE } from "@/lib/auth/cognito";

// Kicks off login: redirect to Cognito Hosted UI (straight to Google/LinkedIn).
// A random `state` is stashed in a short-lived cookie for CSRF + post-login return.
export async function GET(req: Request) {
  if (!COGNITO_ENABLED()) {
    return NextResponse.json({ error: "cognito not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "google";
  const returnTo = url.searchParams.get("returnTo") ?? "/dashboard";
  const state = crypto.randomUUID();

  // Whitelist the post-login return path: must be a relative path on this site.
  // Anything else (absolute URL, protocol-relative, javascript:) gets ignored —
  // otherwise an attacker could send a victim to /api/auth/login?returnTo=evil.com
  // and bounce them off our domain after login.
  const safeReturnTo = /^\/[^/\\]/.test(returnTo) ? returnTo : "/dashboard";

  const res = NextResponse.redirect(authorizeUrl(provider, state));
  res.cookies.set(STATE_COOKIE, `${state}|${safeReturnTo}`, {
    httpOnly: true,
    // Workers may not set NODE_ENV — secure unless we're on plain localhost.
    secure: !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url.origin),
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
