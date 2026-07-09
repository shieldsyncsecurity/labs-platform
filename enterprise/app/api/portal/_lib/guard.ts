// Shared fail-closed helpers for the employer-portal API routes.
//
// Authorization stays on the SAME chokepoint as every other portal route --
// getOrgId() from lib/server/portal-session, called by each route itself.
// These helpers only centralize the two ownership proofs several routes
// repeat (the assessment belongs to the caller's org AND the invite belongs
// to that assessment -- see app/api/portal/invites/revoke/route.ts for the
// original write-up of why BOTH checks are required to stop cross-tenant
// action on another org's inviteToken), plus the audit `actor` derivation.

import { cookies } from "next/headers";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { verifyOrgSession } from "@/lib/server/auth-session";

type Assessment = {
  assessmentId?: string;
  orgId?: string;
};

type Invite = {
  assessmentId?: string;
};

// Mirrors the (unexported) cookie name in lib/server/portal-session.ts. Read
// here ONLY to attach the signed-in staff email to engine audit entries --
// never for authorization, which stays on getOrgId(). If this ever drifts
// from portal-session.ts the only effect is actor falling back to org:<id>.
const PORTAL_COOKIE = "ss_ent_org";

// Engine clamps actor to 120 chars; clamp here too so we never send junk.
const MAX_ACTOR_CHARS = 120;

export type OwnershipFailure = { status: number; error: string };

/**
 * Audit identity for engine mutations made on behalf of the signed-in org:
 * the verified session email when the Cognito sign-in carried one, otherwise
 * a stable "org:<orgId>" marker. Best-effort by design -- any failure here
 * degrades attribution, never authorization.
 */
export async function getPortalActor(orgId: string): Promise<string> {
  try {
    const store = await cookies();
    const value = store.get(PORTAL_COOKIE)?.value;
    if (value) {
      const session = await verifyOrgSession(value);
      // Only trust the email if the session resolves to the SAME org the
      // caller was authorized as -- anything else falls through.
      if (session?.orgId === orgId && session.email) {
        return session.email.slice(0, MAX_ACTOR_CHARS);
      }
    }
  } catch {
    /* fall through to the org marker */
  }
  return `org:${orgId}`.slice(0, MAX_ACTOR_CHARS);
}

/**
 * Proves `assessmentId` belongs to the caller's org. Returns null when the
 * check passes, or an { status, error } the route should return verbatim.
 * A foreign assessment fails exactly like a missing one (404, no oracle).
 */
export async function verifyAssessmentOwnership(
  orgId: string,
  assessmentId: string,
): Promise<OwnershipFailure | null> {
  try {
    const assessment = await entFetch<Assessment>("/ent/assessment", {
      query: { assessmentId },
    });
    if (!assessment || assessment.orgId !== orgId) {
      return { status: 404, error: "Assessment not found." };
    }
    return null;
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return { status: 404, error: "Assessment not found." };
    }
    console.error("[portal/_lib/guard] assessment verify failed", err);
    return { status: 502, error: "Could not verify assessment." };
  }
}

/**
 * Proves `inviteToken` sits under `assessmentId`. Callers MUST have already
 * proved the assessment belongs to the org (verifyAssessmentOwnership) --
 * together the two checks prove the invite is the caller's to act on. The
 * sanitized GET /ent/invite has no orgId (candidate-facing by design) but
 * does return the invite's assessmentId, which is all we need.
 */
export async function verifyInviteInAssessment(
  assessmentId: string,
  inviteToken: string,
): Promise<OwnershipFailure | null> {
  try {
    const invite = await entFetch<Invite>("/ent/invite", { query: { inviteToken } });
    if (!invite || invite.assessmentId !== assessmentId) {
      return { status: 404, error: "Invite not found." };
    }
    return null;
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return { status: 404, error: "Invite not found." };
    }
    console.error("[portal/_lib/guard] invite verify failed", err);
    return { status: 502, error: "Could not verify invite." };
  }
}
