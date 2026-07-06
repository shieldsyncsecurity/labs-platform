import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";

type CreateInviteBody = {
  assessmentId?: string;
  candidateName?: string;
  candidateEmail?: string;
};

type Assessment = {
  assessmentId?: string;
  orgId?: string;
};

// Employer-facing: invite a candidate to an assessment (consumes 1 credit).
// orgId always comes from getOrgId() -- and additionally, we re-fetch the
// assessment here and confirm it belongs to the caller's org before letting
// them consume a credit against it. Without that check, an employer could
// guess/enumerate another org's assessmentId and burn ITS credits inviting
// their own candidates to it.
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateInviteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const assessmentId = body.assessmentId?.trim();
  const candidateName = body.candidateName?.trim();
  const candidateEmail = body.candidateEmail?.trim();

  if (!assessmentId || !candidateName || !candidateEmail) {
    return NextResponse.json(
      { error: "assessmentId, candidateName, and candidateEmail are required" },
      { status: 400 },
    );
  }

  // Re-verify ownership before spending a credit against this assessment.
  try {
    const assessment = await entFetch<Assessment>("/ent/assessment", { query: { assessmentId } });
    if (!assessment || assessment.orgId !== orgId) {
      return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Assessment not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not verify assessment." }, { status: 502 });
  }

  try {
    const result = await entFetch("/ent/invites", {
      method: "POST",
      body: { assessmentId, orgId, candidateName, candidateEmail },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not create invite.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not create invite." }, { status: 502 });
  }
}
