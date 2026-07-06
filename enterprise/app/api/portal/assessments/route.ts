import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";

type CreateAssessmentBody = {
  name?: string;
  labSlug?: string;
  hintsOn?: boolean;
};

// Employer-facing: create a new assessment for the SIGNED-IN org. orgId is
// derived from getOrgId() only -- the request body is never trusted for it,
// even if a client sent one.
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateAssessmentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  const labSlug = body.labSlug?.trim();
  const hintsOn = Boolean(body.hintsOn);

  if (!name || !labSlug) {
    return NextResponse.json({ error: "name and labSlug are required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/assessments", {
      method: "POST",
      body: { orgId, name, labSlug, hintsOn },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not create assessment.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not create assessment." }, { status: 502 });
  }
}
