import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/**
 * Withdraw an issued document — for one genuinely issued in error (wrong month,
 * superseded details). Audited with its reference, so a gap in the SSS/HR
 * series is always traceable to a decision rather than looking like a lost
 * document.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string; genId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq, genId } = await params;
  try {
    await hrFetch(`/hr/employees/${encodeURIComponent(seq)}/generated/${encodeURIComponent(genId)}`, {
      method: "DELETE",
      body: { actor },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not withdraw the document." }, { status: 502 });
  }
}
