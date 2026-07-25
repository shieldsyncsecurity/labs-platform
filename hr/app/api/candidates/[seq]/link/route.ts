import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { guardApi } from "@/lib/server/hr-access";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/**
 * Revoke a questionnaire link that has already gone out — the "I sent that to
 * the wrong person" / "we've moved on from this candidate" button.
 *
 * The engine deletes the stored token hash outright, so the link stops working
 * immediately and for good. Anything the candidate already submitted is kept:
 * revoking access to a form is not the same as discarding their answers, and
 * conflating the two would quietly destroy interview evidence.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const denied = await guardApi("candidates", "write");
  if (denied) return denied;
  const actor = await getHrActor();
  const { seq } = await params;

  try {
    await hrFetch(`/hr/candidates/${encodeURIComponent(seq)}/token`, { method: "DELETE", body: { actor } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not cancel the link." }, { status: 502 });
  }
}
