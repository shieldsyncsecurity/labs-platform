// Shared handler for the two report-link lifecycle routes (revoke / renew).
// NOT a route itself -- only route.ts files are routable; the two thin
// siblings in ./revoke and ./renew call this with the action name.
//
// Targets EITHER the assessment's full-report link ({ assessmentId } only)
// or a candidate's report link ({ inviteToken } + { assessmentId }).
// assessmentId is ALWAYS required: it is the ownership anchor -- the same
// two-step proof as invite revoke (assessment belongs to the caller's org,
// and when an inviteToken is given, the invite belongs to that assessment).
//
// Renew re-arms the SAME url (engine contract: revoke for a leaked link,
// never renew) -- the UI copy next to these buttons says so.

import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";
import {
  getPortalActor,
  verifyAssessmentOwnership,
  verifyInviteInAssessment,
} from "../_lib/guard";

type LifecycleBody = {
  assessmentId?: string;
  inviteToken?: string;
};

export async function handleReportLifecycle(
  req: Request,
  action: "revoke" | "renew",
): Promise<NextResponse> {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: LifecycleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const assessmentId = body.assessmentId?.trim();
  const inviteToken = body.inviteToken?.trim();

  if (!assessmentId) {
    return NextResponse.json({ error: "assessmentId is required" }, { status: 400 });
  }

  const assessmentFailure = await verifyAssessmentOwnership(orgId, assessmentId);
  if (assessmentFailure) {
    return NextResponse.json(
      { error: assessmentFailure.error },
      { status: assessmentFailure.status },
    );
  }

  if (inviteToken) {
    const inviteFailure = await verifyInviteInAssessment(assessmentId, inviteToken);
    if (inviteFailure) {
      return NextResponse.json({ error: inviteFailure.error }, { status: inviteFailure.status });
    }
  }

  const actor = await getPortalActor(orgId);

  try {
    const result = await entFetch(`/ent/report/${action}`, {
      method: "POST",
      // inviteToken present => candidate report link; else the full report.
      body: inviteToken ? { inviteToken, actor } : { assessmentId, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    const label = action === "revoke" ? "revoke" : "renew";
    if (err instanceof EntEngineError) {
      console.error(`[portal/report/${action}] failed`, err.status, err.body);
      return NextResponse.json(
        { error: `Could not ${label} the link.` },
        { status: err.status },
      );
    }
    console.error(`[portal/report/${action}] unexpected error`, err);
    return NextResponse.json({ error: `Could not ${label} the link.` }, { status: 502 });
  }
}
