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

// POST-only on purpose. Sign-out mutates session state (clears the cookies), so
// a GET handler would be triggerable cross-site (e.g. <img src=.../api/auth/logout>)
// to force-log-out a user. Matches admin/logout and portal/logout, which are
// also POST-only.
export const POST = handle;
