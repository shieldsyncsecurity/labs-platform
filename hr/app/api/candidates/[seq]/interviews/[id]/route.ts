import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { guardApi } from "@/lib/server/hr-access";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { cancelMeeting, graphConfigured } from "@/lib/server/graph";
import type { Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";

/**
 * Cancel a scheduled interview.
 *
 * Cancels the real calendar event first so the candidate is actually told, then
 * removes our record. If Graph fails we still remove the record but say so —
 * leaving a cancelled interview showing as scheduled is the worse failure, and
 * the message tells the user to clear it in Outlook themselves.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string; id: string }> }) {
  const denied = await guardApi("candidates", "write");
  if (denied) return denied;
  const actor = await getHrActor();
  const { seq, id } = await params;

  let graphWarning: string | null = null;
  try {
    const { candidate } = await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`);
    const iv = (candidate.interviews ?? []).find((x) => x.id === id);
    if (iv?.graphEventId && graphConfigured()) {
      try {
        await cancelMeeting(iv.graphEventId, `The ${candidate.roleAppliedFor} interview has been cancelled.`);
      } catch {
        graphWarning = "The portal record was removed, but the meeting is still on your Outlook calendar — cancel it there.";
      }
    }
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }

  try {
    const data = await hrFetch(`/hr/candidates/${encodeURIComponent(seq)}/interviews/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: { actor },
    });
    return NextResponse.json({ ...(data as object), warning: graphWarning });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Interview not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not cancel the interview." }, { status: 502 });
  }
}
