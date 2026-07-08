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

// Conservative RFC-5321-ish email shape check. Not a full validator on
// purpose -- just enough to reject obvious garbage server-side (the client
// check is not trustworthy). The overall length cap guards the 254-char SMTP
// limit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MAX_NAME_LEN = 200;

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
  const rawName = body.candidateName?.trim();
  // Normalize the email to lowercase before validating/forwarding so the same
  // person can't be double-invited under differing case, and so the engine
  // stores a canonical address.
  const candidateEmail = body.candidateEmail?.trim().toLowerCase();

  if (!assessmentId || !rawName || !candidateEmail) {
    return NextResponse.json(
      { error: "assessmentId, candidateName, and candidateEmail are required" },
      { status: 400 },
    );
  }

  // Server-side validation -- never trust the client to have done this.
  if (candidateEmail.length > MAX_EMAIL_LEN || !EMAIL_RE.test(candidateEmail)) {
    return NextResponse.json({ error: "Enter a valid candidate email address." }, { status: 400 });
  }

  // Cap the name to a sane length (defence against oversized/abusive input).
  const candidateName = rawName.slice(0, MAX_NAME_LEN);

  // Caller-supplied idempotency key. The engine now REQUIRES an inviteToken on
  // create so a double-click / retry maps to the SAME invite instead of
  // burning a second credit. Generate an unguessable one here.
  const inviteToken = crypto.randomUUID();

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
      body: { assessmentId, orgId, candidateName, candidateEmail, inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[portal/invites] create failed", err.status, err.body);
      return NextResponse.json({ error: "Could not create invite." }, { status: err.status });
    }
    console.error("[portal/invites] unexpected error", err);
    return NextResponse.json({ error: "Could not create invite." }, { status: 502 });
  }
}
