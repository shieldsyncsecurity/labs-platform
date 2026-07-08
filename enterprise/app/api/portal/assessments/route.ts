import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";

type CreateAssessmentBody = {
  name?: string;
  labSlug?: string;
  hintsOn?: boolean;
};

// Server-side allowlist of enterprise lab slugs an assessment may be created
// against. The employer UI (app/portal/assessments/new/new-assessment-form.tsx)
// currently surfaces a subset of these; this set is the authoritative guard so
// a hand-crafted request can't create an assessment against an arbitrary /
// unknown slug. Keep in sync with the engine's recognized enterprise labs.
const ALLOWED_LAB_SLUGS = new Set([
  "s3-misconfiguration-audit",
  "s3-misconfiguration-remediation",
  "iam-least-privilege",
]);

const MAX_NAME_LEN = 200;

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

  const rawName = body.name?.trim();
  const labSlug = body.labSlug?.trim();
  const hintsOn = Boolean(body.hintsOn);

  if (!rawName || !labSlug) {
    return NextResponse.json({ error: "name and labSlug are required" }, { status: 400 });
  }

  // Reject unknown lab slugs server-side -- do not forward an arbitrary slug
  // to the engine.
  if (!ALLOWED_LAB_SLUGS.has(labSlug)) {
    return NextResponse.json({ error: "Unknown lab." }, { status: 400 });
  }

  // Cap the assessment name to a sane length.
  const name = rawName.slice(0, MAX_NAME_LEN);

  try {
    const result = await entFetch("/ent/assessments", {
      method: "POST",
      body: { orgId, name, labSlug, hintsOn },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[portal/assessments] create failed", err.status, err.body);
      return NextResponse.json({ error: "Could not create assessment." }, { status: err.status });
    }
    console.error("[portal/assessments] unexpected error", err);
    return NextResponse.json({ error: "Could not create assessment." }, { status: 502 });
  }
}
