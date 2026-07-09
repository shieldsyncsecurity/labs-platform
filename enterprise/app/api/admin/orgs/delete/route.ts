import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// ShieldSync-staff only: delete an org. The engine refuses if the org has any
// assessments (candidate data must not be orphaned), so this only ever removes
// empty/mistaken/test orgs. The admin session is checked FIRST (getAdminActor
// is null without a valid session -- same fail-closed gate as getAdminSession,
// plus the E9 audit identity); never infer admin-ness from anything else.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
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

  try {
    await entFetch("/ent/orgs/delete", { method: "POST", body: { orgId, actor } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 409) {
      return NextResponse.json(
        { error: "This organization has assessments and can't be deleted." },
        { status: 409 },
      );
    }
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    }
    console.error("[admin/orgs/delete] failed", err);
    return NextResponse.json({ error: "Could not delete organization." }, { status: 502 });
  }
}
