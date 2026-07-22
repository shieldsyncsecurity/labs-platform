import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeUrl, cognitoEnabled, STATE_COOKIE } from "@/lib/server/cognito";

export const dynamic = "force-dynamic";

// Start sign-in: set a CSRF state cookie and redirect to the Cognito Hosted UI.
// When Cognito isn't configured (local dev), bounce to the login page's dev form.
export async function GET(req: Request) {
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  if (!cognitoEnabled()) {
    return NextResponse.redirect(`${base}/login?dev=1`);
  }
  const state = crypto.randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state));
}
