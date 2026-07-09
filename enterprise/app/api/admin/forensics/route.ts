import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// ShieldSync-STAFF only: read-only forensic dossier for one invite, looked up
// by its token (the candidate pastes it into a dispute email, or it comes off
// a problem-report notification). Aggregates three engine reads:
//   1. GET /ent/invite        -- sanitized invite + assessment/org context
//   2. GET /ent/invites       -- the invite's FULL row (timeline + problems[])
//   3. GET /ent/report?assessmentId -- the stored result row, if submitted
// The response is rebuilt field-by-field below: the full invite row contains
// candidateEmail / otpHash / sessionId / candidateReportToken, which must
// NEVER reach the browser, staff session or not. No mutation happens here.
type SanitizedInvite = {
  status?: string;
  candidateName?: string;
  assessmentId?: string;
  expiresAt?: string;
  otpLocked?: boolean;
  consentVersion?: string;
  slotKey?: string;
  name?: string;
  labSlug?: string;
  orgName?: string;
};

type FullInviteRow = {
  inviteToken?: string;
  status?: string;
  createdAt?: string;
  consentAt?: string;
  slotAt?: string;
  startedAt?: string;
  submittedAt?: string;
  erasedAt?: string;
  revokedAt?: string;
  lateSubmit?: boolean;
  candidateReportRevokedAt?: string;
  candidateReportExpiresAt?: string;
  problems?: Array<{ ts?: string; message?: string; actor?: string }>;
};

type ResultRow = {
  inviteToken?: string;
  passedCount?: number;
  totalCriteria?: number;
  correctness?: number;
  reflectionScore?: number | null;
  integrity?: string;
  autoSubmitted?: boolean;
  lateSubmit?: boolean;
  secondsLate?: number;
  gradedAt?: string;
  gradeError?: string;
};

export async function POST(req: Request) {
  // Fail-closed staff gate: getAdminActor() is null without a valid admin
  // session (identical gate to getAdminSession, plus identity for logs).
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { inviteToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const inviteToken = body.inviteToken?.trim();
  if (!inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }

  // 1) Sanitized invite -- also validates the token and gives us assessmentId.
  let invite: SanitizedInvite;
  try {
    invite = await entFetch<SanitizedInvite>("/ent/invite", { query: { inviteToken } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "No invite found for that token." }, { status: 404 });
    }
    console.error("[admin/forensics] invite lookup failed", err);
    return NextResponse.json({ error: "Could not look up that invite." }, { status: 502 });
  }

  const assessmentId = invite.assessmentId;

  // 2) Full invite row (timeline + problems[]) -- best-effort: the dossier
  // still renders from the sanitized invite alone if this read fails.
  let timeline: FullInviteRow | null = null;
  if (assessmentId) {
    try {
      const data = await entFetch<{ invites?: FullInviteRow[] }>("/ent/invites", {
        query: { assessmentId },
      });
      timeline = (data?.invites ?? []).find((i) => i.inviteToken === inviteToken) ?? null;
    } catch (err) {
      console.error("[admin/forensics] invites list failed", err);
    }
  }

  // 3) Stored result row, if any -- assessmentId access path (internal, not
  // lifecycle-gated) so a revoked share link never hides forensics data.
  let result: ResultRow | null = null;
  if (assessmentId) {
    try {
      const data = await entFetch<{ results?: ResultRow[] }>("/ent/report", {
        query: { assessmentId },
      });
      result = (data?.results ?? []).find((r) => r.inviteToken === inviteToken) ?? null;
    } catch (err) {
      // A 404 here just means no results yet; anything else is best-effort too.
      if (!(err instanceof EntEngineError && err.status === 404)) {
        console.error("[admin/forensics] report lookup failed", err);
      }
    }
  }

  // Rebuild the response with ONLY the fields the dossier needs -- never
  // spread the raw rows (they carry live credentials and PII beyond need).
  const problems = Array.isArray(timeline?.problems)
    ? timeline.problems.map((p) => ({
        ts: p?.ts ?? null,
        message: typeof p?.message === "string" ? p.message : "",
        actor: p?.actor ?? null,
      }))
    : [];

  return NextResponse.json({
    invite: {
      status: timeline?.status ?? invite.status ?? null,
      candidateName: invite.candidateName ?? null,
      assessmentName: invite.name ?? null,
      labSlug: invite.labSlug ?? null,
      orgName: invite.orgName ?? null,
      slotKey: invite.slotKey ?? null,
      consentVersion: invite.consentVersion ?? null,
      otpLocked: invite.otpLocked ?? false,
      expiresAt: invite.expiresAt ?? null,
    },
    timeline: {
      createdAt: timeline?.createdAt ?? null,
      consentAt: timeline?.consentAt ?? null,
      slotAt: timeline?.slotAt ?? null,
      startedAt: timeline?.startedAt ?? null,
      submittedAt: timeline?.submittedAt ?? null,
      erasedAt: timeline?.erasedAt ?? null,
      revokedAt: timeline?.revokedAt ?? null,
      candidateReportRevokedAt: timeline?.candidateReportRevokedAt ?? null,
      candidateReportExpiresAt: timeline?.candidateReportExpiresAt ?? null,
    },
    problems,
    result: result
      ? {
          passedCount: result.passedCount ?? 0,
          totalCriteria: result.totalCriteria ?? 0,
          reflectionScore: result.reflectionScore ?? null,
          integrity: result.integrity ?? null,
          autoSubmitted: result.autoSubmitted === true,
          lateSubmit: result.lateSubmit === true,
          secondsLate: result.secondsLate ?? null,
          gradedAt: result.gradedAt ?? null,
          gradeError: result.gradeError ?? null,
        }
      : null,
  });
}
