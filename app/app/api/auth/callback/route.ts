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
import { engineFetch } from "@/lib/server/engine";

// Cognito redirects the browser here with ?code & ?state. We exchange the code,
// verify the ID token, set our session cookie, persist the user (marketing DB,
// via the engine), then bounce back into the app.

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!COGNITO_ENABLED()) return NextResponse.redirect(new URL("/sign-in?error=not_configured", url.origin));

  const err = url.searchParams.get("error");
  if (err) {
    // Log just the error code + description — never url.search (it can contain
    // the OAuth code / state which together are a one-shot session bootstrap).
    console.error("[auth/callback] Cognito error:", err, "desc:", url.searchParams.get("error_description"));
    return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(err)}`, url.origin));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/sign-in?error=missing_code", url.origin));

  // CSRF: the state must match what we stored, and it carries the return path.
  const raw = (await cookies()).get(STATE_COOKIE)?.value ?? "";
  // Split on the FIRST "|" only so a returnTo that contains "|" survives intact
  // (state is a UUID with no "|"; everything after the first separator is the path).
  const sep = raw.indexOf("|");
  const savedState = sep === -1 ? raw : raw.slice(0, sep);
  const returnToRaw = (sep === -1 ? "" : raw.slice(sep + 1)) || "/dashboard";
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(new URL("/sign-in?error=bad_state", url.origin));
  }
  // Belt-and-suspenders open-redirect guard: login already sanitizes, but if the
  // cookie was somehow forged, only honour a relative path on THIS origin.
  const returnTo = /^\/[^/\\]/.test(returnToRaw) ? returnToRaw : "/dashboard";

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
      await engineFetch("/user", { body: user, userId: user.id });
    } catch {}
  });

  const res = NextResponse.redirect(new URL(returnTo, url.origin));
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    // Workers may not set NODE_ENV — default to secure UNLESS we're on a plain
    // localhost dev origin. Cookies without Secure get rejected by browsers on
    // https in any modern setup, but we explicitly enforce it here.
    secure: !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url.origin),
    sameSite: "lax",
    maxAge: 7 * 24 * 3600,
    path: "/",
  });
  res.cookies.delete(STATE_COOKIE);
  return res;
}
