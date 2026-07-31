import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/server/hr-access";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/** Void an acceptance recorded in error — a test click, or the wrong person
 * clicking a forwarded offer email. Admin only: an acceptance is evidence, and
 * erasing evidence is an owner action. The engine audits what it erased. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string; genId: string }> }) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { seq, genId } = await params;
  try {
    const actor = await getHrActor();
    const data = await hrFetch(`/hr/employees/${seq}/generated/${genId}/accept`, { method: "DELETE", body: { actor } });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not void the acceptance." }, { status: 502 });
  }
}
