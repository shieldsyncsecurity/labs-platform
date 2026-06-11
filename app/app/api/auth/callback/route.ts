import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCode,
  verifyIdToken,
  makeSession,
  providerFromClaims,
  COGNITO_ENABLED,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "@/lib/auth/cognito";

// Cognito redirects the browser here with ?code & ?state. We exchange the code,
// verify the ID token, set our session cookie, persist the user (marketing DB,
// via the engine), then bounce back into the app.
const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:4000";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!COGNITO_ENABLED()) return NextResponse.redirect(new URL("/sign-in?error=not_configured", url.origin));

  const err = url.searchParams.get("error");
  if (err) {
    console.error("[auth/callback] Cognito error:", err, "desc:", url.searchParams.get("error_description"), "full:", url.search);
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(err)}`, url.origin));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/sign-in?error=missing_code", url.origin));

  // CSRF: the state must match what we stored, and it carries the return path.
  const raw = (await cookies()).get(STATE_COOKIE)?.value ?? "";
  const [savedState, returnTo = "/dashboard"] = raw.split("|");
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(new URL("/sign-in?error=bad_state", url.origin));
  }

  let user;
  try {
    const tokens = await exchangeCode(code);
    const claims = await verifyIdToken(tokens.id_token);
    const name =
      String(claims.name ?? "").trim() ||
      `${claims.given_name ?? ""} ${claims.family_name ?? ""}`.trim() ||
      String(claims.email ?? "Learner");
    user = {
      id: String(claims.sub),
      email: String(claims.email ?? ""),
      name,
      provider: providerFromClaims(claims),
    };
  } catch (e) {
    console.error("[auth/callback]", e);
    return NextResponse.redirect(new URL("/sign-in?error=auth_failed", url.origin));
  }

  const session = await makeSession(user);

  // Persist for marketing (never blocks login). The engine holds AWS creds and
  // writes to the ShieldSyncLabUsers table. Must run inside after(): on
  // Cloudflare Workers a plain fire-and-forget fetch is cancelled as soon as
  // the response returns — after() maps to ctx.waitUntil so it completes.
  // (Verified live 2026-06-11: two successful logins, zero table writes.)
  after(async () => {
    try {
      await fetch(`${ENGINE_URL}/user`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(user),
      });
    } catch {}
  });

  const res = NextResponse.redirect(new URL(returnTo, url.origin));
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
