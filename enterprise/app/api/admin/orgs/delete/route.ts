import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";

// ShieldSync-staff only: delete an org. The engine refuses if the org has any
// assessments (candidate data must not be orphaned), so this only ever removes
// empty/mistaken/test orgs. getAdminSession() is checked FIRST; never infer
// admin-ness from anything else.
export async function POST(req: Request) {
  if (!(await getAdminSession())) {
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
    await entFetch("/ent/orgs/delete", { method: "POST", body: { orgId, actor: "admin" } });
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
