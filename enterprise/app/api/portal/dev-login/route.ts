import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { setOrgIdCookie } from "@/lib/server/portal-session";

// DEV-ONLY sign-in. There is no real employer auth yet (see README + the
// portal-session TODO) -- this route exists purely so the portal is
// reachable during MVP build-out. It does the minimum a "real" login must
// eventually do: confirm the orgId actually corresponds to a real org
// (via the engine) BEFORE trusting it, then stamp the session cookie.
//
// TODO: replace this whole route with Cognito enterprise-pool sign-in
// (email + password + TOTP). Once that lands, this route (and the
// PORTAL_DEV_LOGIN gate below) should be deleted entirely -- orgId will
// come from the verified session's custom:orgId claim, never from a
// form field.
//
// Gate: only usable when PORTAL_DEV_LOGIN is set. This app has no real
// auth yet, so for the MVP deployment this is effectively always on --
// the env var exists so it's a single flip to turn OFF once Cognito
// lands, without having to touch this file again.
export async function POST(req: Request) {
  if (!process.env.PORTAL_DEV_LOGIN) {
    return NextResponse.json(
      { error: "Dev sign-in is disabled. Set PORTAL_DEV_LOGIN to enable it." },
      { status: 404 },
    );
  }

  let body: { orgId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId?.trim();
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  }

  // Confirm the org actually exists before minting a session for it --
  // never trust the pasted id blindly, even in dev.
  try {
    await entFetch("/ent/orgs", { query: { orgId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "No org found with that id." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not verify org." }, { status: 502 });
  }

  await setOrgIdCookie(orgId);
  return NextResponse.json({ ok: true });
}
