import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { guardApi } from "@/lib/server/hr-access";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { createTeamsMeeting, graphConfigured, GraphError } from "@/lib/server/graph";
import { COMPANY } from "@/lib/company";
import type { Candidate, Interview } from "@/lib/candidate";
import { formatIST } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

/**
 * Schedule an interview.
 *
 * Order matters: create the calendar meeting FIRST, then record it. If Graph
 * fails we return the error and store nothing — a portal record for a meeting
 * that was never sent is worse than no record, because you'd stop chasing it.
 * The reverse order would leave exactly that.
 *
 * `sendInvite: false` books a private hold: no attendee, no email. Useful for
 * pencilling a slot before confirming with the candidate.
 */
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const denied = await guardApi("candidates", "write");
  if (denied) return denied;
  const actor = await getHrActor();
  const { seq } = await params;

  let input: {
    startsAt?: string;
    durationMinutes?: number;
    panel?: string;
    round?: string;
    notes?: string;
    sendInvite?: boolean;
    /** Pre-made Teams/Meet link, when the meeting was created in Outlook by hand. */
    meetingUrl?: string;
  };
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const startsAt = (input.startsAt ?? "").trim();
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    return NextResponse.json({ error: "A valid date and time is required." }, { status: 400 });
  }
  const durationMinutes = Number(input.durationMinutes) > 0 ? Math.round(Number(input.durationMinutes)) : 45;

  let candidate: Candidate;
  try {
    candidate = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }

  const interview: Partial<Interview> = {
    startsAt: new Date(startsAt).toISOString(),
    durationMinutes,
    panel: input.panel?.trim() || undefined,
    round: input.round?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    meetingUrl: input.meetingUrl?.trim() || undefined,
  };

  // --- Real calendar meeting -------------------------------------------------
  const wantsInvite = input.sendInvite !== false;
  if (!interview.meetingUrl && graphConfigured()) {
    try {
      const meeting = await createTeamsMeeting({
        subject: `${candidate.roleAppliedFor} interview — ${candidate.name}`,
        startsAt: interview.startsAt!,
        durationMinutes,
        attendeeEmail: wantsInvite ? candidate.email : undefined,
        attendeeName: wantsInvite ? candidate.name : undefined,
        body:
          `<p>Hi ${candidate.name.split(" ")[0]},</p>` +
          `<p>Looking forward to speaking with you about the ${candidate.roleAppliedFor} role at ${COMPANY.legalName}.</p>` +
          `<p>Joining details are below. If this time doesn't work, just reply to this invite.</p>`,
      });
      interview.meetingUrl = meeting.joinUrl;
      interview.graphEventId = meeting.eventId;
      if (wantsInvite) interview.invitedAt = new Date().toISOString();
    } catch (err) {
      const detail = err instanceof GraphError ? `Microsoft Graph returned ${err.status}.` : "Couldn't reach Microsoft.";
      return NextResponse.json(
        { error: `${detail} Nothing was scheduled — create the meeting in Outlook and paste the link instead.` },
        { status: 502 },
      );
    }
  } else if (!graphConfigured() && wantsInvite && !interview.meetingUrl) {
    // Be explicit rather than silently recording a meeting with no link.
    return NextResponse.json(
      { error: "Teams isn't connected yet, so no invite can be sent. Create the meeting in Outlook and paste its link here." },
      { status: 400 },
    );
  }

  try {
    const data = await hrFetch<{ interview: Interview; interviews: Interview[] }>(
      `/hr/candidates/${encodeURIComponent(seq)}/interviews`,
      { method: "POST", body: { interview, actor } },
    );
    return NextResponse.json({
      ...data,
      summary: `${candidate.name} — ${formatIST(interview.startsAt!)}${wantsInvite ? ", invite sent" : " (hold only)"}`,
    });
  } catch {
    // The meeting exists but we couldn't record it. Say so plainly — silence
    // here means an invite the candidate has and the portal doesn't know about.
    return NextResponse.json(
      { error: "The meeting was created in Outlook but couldn't be saved to the portal. Check your calendar before retrying." },
      { status: 502 },
    );
  }
}
