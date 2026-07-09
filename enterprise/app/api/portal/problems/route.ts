import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";
import {
  getPortalActor,
  verifyAssessmentOwnership,
  verifyInviteInAssessment,
} from "../_lib/guard";

type ReportProblemBody = {
  inviteToken?: string;
  assessmentId?: string;
  message?: string;
};

// Engine clamps to 2000 too -- reject early with a real error instead of
// silently truncating what the employer wrote.
const MAX_MESSAGE_CHARS = 2000;

// Employer-facing: report a problem with a candidate's invite (dispute path,
// engine E6). Requires assessmentId in the body so we can re-verify org
// ownership before forwarding -- the SAME two-step proof as invite revoke:
// the assessment must belong to the caller's org AND the invite must belong
// to that assessment. orgId itself still only ever comes from getOrgId().
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: ReportProblemBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const inviteToken = body.inviteToken?.trim();
  const assessmentId = body.assessmentId?.trim();
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!inviteToken || !assessmentId) {
    return NextResponse.json(
      { error: "inviteToken and assessmentId are required" },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json({ error: "Describe the problem first." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Keep the description under ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  const assessmentFailure = await verifyAssessmentOwnership(orgId, assessmentId);
  if (assessmentFailure) {
    return NextResponse.json(
      { error: assessmentFailure.error },
      { status: assessmentFailure.status },
    );
  }

  const inviteFailure = await verifyInviteInAssessment(assessmentId, inviteToken);
  if (inviteFailure) {
    return NextResponse.json({ error: inviteFailure.error }, { status: inviteFailure.status });
  }

  const actor = await getPortalActor(orgId);

  try {
    const result = await entFetch("/ent/problems", {
      method: "POST",
      body: { inviteToken, message, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[portal/problems] report failed", err.status, err.body);
      return NextResponse.json({ error: "Could not send the report." }, { status: err.status });
    }
    console.error("[portal/problems] unexpected error", err);
    return NextResponse.json({ error: "Could not send the report." }, { status: 502 });
  }
}
