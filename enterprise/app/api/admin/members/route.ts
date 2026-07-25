import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// Staff-only: manage which Cognito subjects may open which employer org's portal.
// This is the record auth/callback checks the custom:orgId claim against, so a
// seat bound here is what actually grants portal access — creating the Cognito
// user alone does NOT. Same admin gate as every other app/api/admin/* route.

/** List the seats on an org. */
export async function GET(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get("orgId")?.trim();
  if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 });

  try {
    return NextResponse.json(await entFetch("/ent/members", { query: { orgId } }));
  } catch (err) {
    const status = err instanceof EntEngineError ? err.status : 502;
    return NextResponse.json({ error: "Could not load seats." }, { status });
  }
}

/** Bind a Cognito subject to this org, or revoke it (`action: "revoke"`). */
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { sub?: string; orgId?: string; email?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const sub = body.sub?.trim();
  if (!sub) return NextResponse.json({ error: "sub is required" }, { status: 400 });

  try {
    if (body.action === "revoke") {
      await entFetch("/ent/members/delete", { method: "POST", body: { sub, actor } });
      return NextResponse.json({ ok: true });
    }
    const orgId = body.orgId?.trim();
    if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 });
    const result = await entFetch("/ent/members", {
      method: "POST",
      body: { sub, orgId, email: body.email?.trim() ?? "", actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "Could not update seats.", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "Could not update seats." }, { status: 502 });
  }
}
