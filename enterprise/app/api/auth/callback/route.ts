import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, verifyIdToken, STATE_COOKIE } from "@/lib/server/cognito";
import { setOrgIdCookie } from "@/lib/server/portal-session";
import { setAdminCookie } from "@/lib/server/admin-session";

// Cognito Hosted-UI redirect target. Validates the CSRF `state`, exchanges the
// auth code for tokens, verifies the id_token signature (jose/JWKS), then routes
// the user by verified claim:
//   - email in ADMIN_EMAILS  -> ShieldSync-staff admin session -> /admin
//   - custom:orgId present   -> employer portal session         -> /portal
//   - neither                -> signed in but not provisioned   -> login error
//
// The two session cookies are minted by their OWN chokepoint modules
// (admin-session / portal-session) so the staff/employer trust boundaries stay
// separate. Staff allowlist is checked FIRST and wins outright.

function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL ?? url.origin;
  const loginErr = (code: string) =>
    NextResponse.redirect(`${base}/portal/login?error=${code}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return loginErr("sso");
  if (!code || !state) return loginErr("missing_code");

  // CSRF: the returned state must match the cookie we set at /api/auth/login.
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!expectedState || expectedState !== state) return loginErr("state");

  let email = "";
  let sub: string | undefined;
  let orgId = "";
  try {
    const { id_token } = await exchangeCode(code);
    const payload = await verifyIdToken(id_token);
    email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    sub = typeof payload.sub === "string" ? payload.sub : undefined;
    orgId =
      typeof payload["custom:orgId"] === "string"
        ? (payload["custom:orgId"] as string).trim()
        : "";
  } catch {
    return loginErr("exchange");
  }

  if (email && adminEmails().has(email)) {
    await setAdminCookie({ sub, email });
    return NextResponse.redirect(`${base}/admin`);
  }
  if (orgId) {
    await setOrgIdCookie(orgId, { sub, email });
    return NextResponse.redirect(`${base}/portal`);
  }
  // Authenticated but has no org and is not staff -- nothing to show them.
  return loginErr("no_access");
}
