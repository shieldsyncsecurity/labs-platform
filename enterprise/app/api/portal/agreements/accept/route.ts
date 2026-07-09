import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";
import { getOrgAgreement } from "@/lib/server/agreement-gate";
import { getPortalActor } from "../../_lib/guard";

type AcceptBody = {
  agreementId?: string;
};

// Employer-facing: accept an ISSUED agreement (sprint W3-5). Fail-closed:
// orgId comes ONLY from the session, and the agreement's own orgId must match
// it before we forward -- a foreign or unknown agreementId fails exactly like
// a missing one (404, no oracle). The engine enforces the issued->accepted
// state machine (409 NOT_ACCEPTABLE) and is idempotent on repeat accepts.
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: AcceptBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const agreementId = body.agreementId?.trim();
  if (!agreementId) {
    return NextResponse.json({ error: "agreementId is required" }, { status: 400 });
  }

  // Ownership proof (fail-closed, unlike the page gate): the full row's orgId
  // must equal the session org. Drafts also 404 here (internal working copy).
  let agreement;
  try {
    agreement = await getOrgAgreement(orgId, agreementId);
  } catch (err) {
    console.error("[portal/agreements/accept] ownership check failed", err);
    return NextResponse.json({ error: "Could not verify the agreement." }, { status: 502 });
  }
  if (!agreement) {
    return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
  }

  // Signed-in staff email when the session carries one (engine requires
  // acceptedBy; the actor doubles as the audit identity).
  const actor = await getPortalActor(orgId);
  // A legal acceptance needs a NAMED person on the permanent record. The
  // email-less session fallback ("org:<id>") is fine for audit lines but not
  // as the signer of a contract -- require a real signed-in email.
  if (!actor.includes("@")) {
    return NextResponse.json(
      { error: "Sign in with your named account (email) to accept this agreement." },
      { status: 403 },
    );
  }

  try {
    const result = await entFetch("/ent/agreements/accept", {
      method: "POST",
      body: { agreementId, acceptedBy: actor, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      if (err.status === 409) {
        return NextResponse.json(
          { error: "This agreement can no longer be accepted." },
          { status: 409 },
        );
      }
      console.error("[portal/agreements/accept] engine error", err.status, err.body);
      return NextResponse.json(
        { error: "Could not record your acceptance." },
        { status: err.status },
      );
    }
    console.error("[portal/agreements/accept] unexpected error", err);
    return NextResponse.json({ error: "Could not record your acceptance." }, { status: 502 });
  }
}
