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

type Invite = {
  orgId?: string;
  assessmentId?: string;
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
    console.error("[portal/invites/revoke] assessment verify failed", err);
    return NextResponse.json({ error: "Could not verify assessment." }, { status: 502 });
  }

  // Prove the invite ITSELF belongs to the caller's org before revoking it.
  // Verifying only the supplied assessmentId is NOT enough: the engine's
  // /ent/invites/revoke takes just { inviteToken }, so without this check an
  // employer could pass their own (valid) assessmentId alongside ANOTHER
  // org's inviteToken and revoke it -- a cross-tenant denial of service.
  //
  // The engine's GET /ent/invite returns a SANITIZED invite (no orgId by
  // design -- it is shared with the candidate-facing proxy) but it DOES return
  // the invite's assessmentId. We already proved `assessmentId` belongs to this
  // org above, so requiring invite.assessmentId === assessmentId proves the
  // invite sits under an assessment this org owns.
  try {
    const invite = await entFetch<Invite>("/ent/invite", { query: { inviteToken } });
    if (!invite || invite.assessmentId !== assessmentId) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }
    console.error("[portal/invites/revoke] invite verify failed", err);
    return NextResponse.json({ error: "Could not verify invite." }, { status: 502 });
  }

  try {
    const result = await entFetch("/ent/invites/revoke", {
      method: "POST",
      body: { inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[portal/invites/revoke] revoke failed", err.status, err.body);
      return NextResponse.json({ error: "Could not revoke invite." }, { status: err.status });
    }
    console.error("[portal/invites/revoke] unexpected error", err);
    return NextResponse.json({ error: "Could not revoke invite." }, { status: 502 });
  }
}
