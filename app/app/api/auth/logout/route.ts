import { NextResponse } from "next/server";
import { logoutUrl, COGNITO_ENABLED, SESSION_COOKIE } from "@/lib/auth/cognito";

// Clear our session cookie, then bounce through Cognito's logout so the Hosted
// UI session is dropped too.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dest = COGNITO_ENABLED() ? logoutUrl() : new URL("/", url.origin).toString();
  const res = NextResponse.redirect(dest);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
