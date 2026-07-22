import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode, verifyIdToken, STATE_COOKIE } from "@/lib/server/cognito";
import { setHrCookie } from "@/lib/server/hr-session";
import { isAllowed } from "@/lib/server/hr-token";

export const dynamic = "force-dynamic";

// Cognito Hosted-UI redirect target. Validates CSRF state, exchanges the code,
// verifies the id_token signature (jose/JWKS), then admits ONLY an
// email_verified address on the HR allowlist. Anyone else — even a valid
// Cognito user — is denied.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL ?? url.origin;
  const loginErr = (code: string) => NextResponse.redirect(`${base}/login?error=${code}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) return loginErr("sso");
  if (!code || !state) return loginErr("missing_code");

  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!expected || expected !== state) return loginErr("state");

  let idToken: string;
  try {
    idToken = (await exchangeCode(code)).id_token;
  } catch (e) {
    console.error("[hr auth/callback] token exchange failed:", e instanceof Error ? e.message : String(e));
    return loginErr("token");
  }

  let email = "";
  let sub: string | undefined;
  // Require email_verified === true explicitly (not merely "not false"), so a
  // federated IdP that leaves the claim undefined can never satisfy the gate.
  let emailVerifiedOk = false;
  try {
    const p = await verifyIdToken(idToken);
    email = typeof p.email === "string" ? p.email.toLowerCase() : "";
    sub = typeof p.sub === "string" ? p.sub : undefined;
    const ev = p["email_verified"];
    emailVerifiedOk = ev === true || ev === "true";
  } catch (e) {
    console.error("[hr auth/callback] id_token verify failed:", e instanceof Error ? e.message : String(e));
    return loginErr("verify");
  }

  if (email && emailVerifiedOk && isAllowed(email)) {
    await setHrCookie({ sub, email });
    return NextResponse.redirect(`${base}/`);
  }
  return loginErr("not_allowed");
}
