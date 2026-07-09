import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";
import { getPortalActor, verifyAssessmentOwnership } from "../../_lib/guard";

type UpdateAssessmentBody = {
  assessmentId?: string;
  name?: string;
  hintsOn?: boolean;
};

// Engine clamps the name to 200; cap here too so we never send junk.
const MAX_NAME_LEN = 200;

// Employer-facing: rename an assessment / toggle in-lab hints (W3B-4). orgId
// always comes from getOrgId() -- and we re-verify the assessment belongs to
// the caller's org before forwarding (same ownership proof as invite revoke /
// report lifecycle). The engine's /ent/assessments/update takes just the
// assessmentId, so this app-side org check is the ONLY thing stopping a
// crafted request from renaming another org's assessment.
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: UpdateAssessmentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const assessmentId = body.assessmentId?.trim();
  if (!assessmentId) {
    return NextResponse.json({ error: "assessmentId is required" }, { status: 400 });
  }

  // Build the patch from ONLY the fields the client actually sent, so a rename
  // never silently flips hints (and vice-versa). At least one field required.
  const patch: { name?: string; hintsOn?: boolean } = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      return NextResponse.json({ error: "Enter a name for this assessment." }, { status: 400 });
    }
    patch.name = name.slice(0, MAX_NAME_LEN);
  }
  if (body.hintsOn !== undefined) {
    patch.hintsOn = body.hintsOn === true;
  }
  if (patch.name === undefined && patch.hintsOn === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const assessmentFailure = await verifyAssessmentOwnership(orgId, assessmentId);
  if (assessmentFailure) {
    return NextResponse.json(
      { error: assessmentFailure.error },
      { status: assessmentFailure.status },
    );
  }

  const actor = await getPortalActor(orgId);

  try {
    const result = await entFetch("/ent/assessments/update", {
      method: "POST",
      body: { assessmentId, ...patch, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[portal/assessments/update] failed", err.status, err.body);
      return NextResponse.json(
        { error: "Could not update assessment." },
        { status: err.status },
      );
    }
    console.error("[portal/assessments/update] unexpected error", err);
    return NextResponse.json({ error: "Could not update assessment." }, { status: 502 });
  }
}
