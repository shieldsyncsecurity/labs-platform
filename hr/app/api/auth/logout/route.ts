import { NextResponse } from "next/server";
import { clearHrSession } from "@/lib/server/hr-session";
import { cognitoEnabled, logoutUrl } from "@/lib/server/cognito";

export const dynamic = "force-dynamic";

// Clear the HR session cookie, then bounce through the Cognito Hosted-UI logout
// (so the IdP session ends too) or back to /login in local dev.
export async function GET(req: Request) {
  const base = process.env.APP_URL ?? new URL(req.url).origin;
  await clearHrSession();
  if (cognitoEnabled()) return NextResponse.redirect(logoutUrl());
  return NextResponse.redirect(`${base}/login`);
}
