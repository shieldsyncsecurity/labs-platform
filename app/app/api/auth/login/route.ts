import { NextResponse } from "next/server";
import { authorizeUrl, COGNITO_ENABLED, STATE_COOKIE } from "@/lib/auth/cognito";

// Kicks off login: redirect to Cognito Hosted UI (straight to Google/LinkedIn).
// A random `state` is stashed in a short-lived cookie for CSRF + post-login return.
export async function GET(req: Request) {
  if (!COGNITO_ENABLED) {
    return NextResponse.json({ error: "cognito not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "google";
  const returnTo = url.searchParams.get("returnTo") ?? "/dashboard";
  const state = crypto.randomUUID();

  const res = NextResponse.redirect(authorizeUrl(provider, state));
  res.cookies.set(STATE_COOKIE, `${state}|${returnTo}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
