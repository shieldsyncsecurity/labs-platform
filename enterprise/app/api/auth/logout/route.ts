import { NextResponse } from "next/server";
import { cognitoEnabled, logoutUrl } from "@/lib/server/cognito";
import { clearOrgId } from "@/lib/server/portal-session";
import { clearAdminSession } from "@/lib/server/admin-session";

// Signs the user out of BOTH possible sessions (only one is ever set, but
// clearing both is cheap and keeps this the single sign-out path) and then
// bounces through the Cognito Hosted-UI logout so the IdP session is dropped
// too -- otherwise the next /api/auth/login would silently re-auth them.

async function handle(): Promise<NextResponse> {
  await clearOrgId();
  await clearAdminSession();
  const dest = cognitoEnabled() ? logoutUrl() : (process.env.APP_URL ?? "/");
  return NextResponse.redirect(dest);
}

export const GET = handle;
export const POST = handle;
