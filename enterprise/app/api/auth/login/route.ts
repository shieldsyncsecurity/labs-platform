import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authorizeUrl, cognitoEnabled, STATE_COOKIE } from "@/lib/server/cognito";

// Kicks off the Cognito Hosted-UI Authorization-Code flow. Sets a short-lived,
// httpOnly CSRF `state` cookie and redirects the browser to Cognito. The
// matching value comes back on /api/auth/callback, which rejects a mismatch.
//
// Shared entry point for BOTH employer users and ShieldSync staff -- the
// callback decides where each lands based on the verified claims, so there is
// exactly one place that talks to Cognito.

function randomState(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function GET() {
  if (!cognitoEnabled()) {
    return NextResponse.json({ error: "SSO is not configured." }, { status: 404 });
  }
  const state = randomState();
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes -- long enough to complete sign-in, no longer.
  });
  return NextResponse.redirect(authorizeUrl(state));
}
