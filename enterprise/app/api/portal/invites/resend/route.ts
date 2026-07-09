import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getOrgId } from "@/lib/server/portal-session";
import {
  getPortalActor,
  verifyAssessmentOwnership,
  verifyInviteInAssessment,
} from "../../_lib/guard";

type ResendInviteBody = {
  inviteToken?: string;
  assessmentId?: string;
};

// Employer-facing: re-send a candidate their magic-link email (W3B-3). NEVER
// charges a credit. Requires assessmentId in the body so we can run the SAME
// two-step ownership proof as invite revoke -- the assessment must belong to
// the caller's org AND the invite must belong to that assessment -- before
// forwarding to the engine, which takes just { inviteToken }. orgId itself
// still only ever comes from getOrgId().
export async function POST(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: ResendInviteBody;
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
    const result = await entFetch("/ent/invites/resend", {
      method: "POST",
      body: { inviteToken, actor },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      const engineBody = err.body as { error?: string; retryAfter?: number } | undefined;
      const engineCode = engineBody?.error;

      // Per-invite send cooldown -- an EXPECTED throttle, not a failure. Give
      // the button a whitelisted code + a wait hint so it shows a soft notice
      // instead of a scary error. Engine returns 429 { error:"RESEND_COOLDOWN",
      // retryAfter }.
      if (err.status === 429 || engineCode === "RESEND_COOLDOWN") {
        const retryAfter = engineBody?.retryAfter;
        return NextResponse.json(
          {
            error: retryAfter
              ? `Just sent -- wait ${retryAfter}s before resending.`
              : "Just sent -- wait a moment before resending.",
            code: "RESEND_COOLDOWN",
          },
          { status: 429 },
        );
      }

      // Terminal / undeliverable invites: the button is only offered for
      // non-terminal, emailable rows, but a race or a stale page can still hit
      // these -- surface a real reason rather than a generic failure.
      if (engineCode === "NOT_RESENDABLE") {
        return NextResponse.json(
          { error: "This invite can no longer be emailed." },
          { status: 409 },
        );
      }
      if (engineCode === "LINK_EXPIRED") {
        return NextResponse.json(
          { error: "This invite link has expired." },
          { status: 410 },
        );
      }
      if (engineCode === "NO_CANDIDATE_EMAIL") {
        return NextResponse.json(
          { error: "No candidate email on file for this invite." },
          { status: 400 },
        );
      }

      console.error("[portal/invites/resend] failed", err.status, err.body);
      return NextResponse.json({ error: "Could not resend the email." }, { status: err.status });
    }
    console.error("[portal/invites/resend] unexpected error", err);
    return NextResponse.json({ error: "Could not resend the email." }, { status: 502 });
  }
}
