import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";

type RevokeInviteBody = {
  inviteToken?: string;
  assessmentId?: string;
};

type Assessment = {
  assessmentId?: string;
  orgId?: string;
};

// Employer-facing: revoke a candidate invite. Requires assessmentId in the
// body so we can re-verify org ownership before revoking -- same pattern as
// invite creation. orgId itself still only ever comes from getOrgId().
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: RevokeInviteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const inviteToken = body.inviteToken?.trim();
  const assessmentId = body.assessmentId?.trim();

  if (!inviteToken || !assessmentId) {
    return NextResponse.json(
      { error: "inviteToken and assessmentId are required" },
      { status: 400 },
    );
  }

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
    const result = await entFetch("/ent/invites/revoke", {
      method: "POST",
      body: { inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not revoke invite.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not revoke invite." }, { status: 502 });
  }
}
