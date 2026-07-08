// ShieldSync ENTERPRISE (B2B) — Lambda HTTP handler.
//
// SEPARATE Lambda from the B2C labs engine (handler.mjs) for blast-radius
// isolation: a bug or incident in one engine cannot reach the other's AWS
// resources, tables, or account pool. This handler ONLY talks to entinfra.mjs
// (ShieldSyncEnt* DynamoDB tables) — it never imports labinfra.mjs and never
// touches a ShieldSyncLab* row.
//
// Exposes /ent/* HTTP routes behind API Gateway, same event shape + response
// style as the B2C engine's handler.mjs (API Gateway v2 / Function URL event).

import {
  hashOtp,
  createOrg,
  getOrg,
  deleteOrg,
  addCredits,
  listAllOrgs,
  createAssessment,
  getAssessment,
  getAssessmentByReportToken,
  listAssessments,
  createInvite,
  getInvite,
  getInviteByCandidateReportToken,
  listInvites,
  setInviteStatus,
  consentInvite,
  refundInvite,
  revokeInvite,
  eraseCandidatePii,
  setOtp,
  verifyOtp,
  bookSlot,
  releaseSlot,
  putResult,
  getResult,
  listResults,
  createOrder,
  getOrder,
  listOrders,
  markOrderPaid,
} from "./entinfra.mjs";
import {
  leaseEnt,
  ensureWarmEnt,
  entReservedCounts,
  teardown,
  mintConsoleUrl,
  getSession,
  deployLab,
  markSession,
  releaseAccount,
} from "./labinfra.mjs";
import { gradeLab } from "./graders.mjs";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { randomInt } from "node:crypto";

// Scored time-box for an enterprise assessment attempt (MVP: fixed for all
// labs; per-lab override can come later from assessment/lab config). Lease
// TTL = timebox + grace so a crash/reconnect mid-attempt and the post-submit
// reflection step both have headroom before the account auto-expires.
const ENT_TIMEBOX_MIN = 60;
const ENT_GRACE_MIN = 15;

// OTP send throttling (per-invite). A cooldown between sends and a rolling 24h cap
// resist SES-cost abuse and code-spam. These counters live on the invite and are
// deliberately NOT reset by setOtp (see entinfra.setOtp), so a resend cannot wipe
// them. Max candidate reflection length clamped before grade/persist (Batch E).
const OTP_SEND_COOLDOWN_SEC = 45;
const OTP_SEND_DAILY_CAP = 10;
const REFLECTION_MAX_CHARS = 8000;

const entLambda = new LambdaClient({ region: "us-east-1" });
const ses = new SESClient({ region: "us-east-1" });

// Shared-secret guard for the public HTTP surface (set via Lambda env). The
// enterprise app sends this in the X-Engine-Token header; without it the
// engine refuses non-health requests. Empty string in local dev = guard
// disabled — mirrors handler.mjs's ENGINE_SHARED_SECRET exactly.
const ENT_ENGINE_SECRET = process.env.ENT_ENGINE_SECRET || "";

// True when running inside the Lambda runtime (internet-exposed via API Gateway).
// Used to FAIL CLOSED on auth and to gate dev-only response fields - never trust a
// blank secret in Lambda, and never leak dev conveniences (devCode) there.
const IN_LAMBDA = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Constant-time string compare so a missing header / wrong token can't be
// length-distinguished from a correct one. Same helper as handler.mjs.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ── Async worker actions (deploy + teardown) ─────────────────────────────
//
// Both the real Lambda-worker branch (event._worker, invoked async via
// invokeEntWorker below) and the local-dev inline fallback call these SAME
// functions, so behavior never diverges between prod and local testing.

async function runDeployEnt({ sessionId, accountId, labSlug, execRoleArn }) {
  try {
    await deployLab({ sessionId, accountId, labSlug, execRoleArn });
  } catch (e) {
    console.error(`[ent-worker] deploy failed ${sessionId}: ${e.message}`);
    // Deploy failed before anything was provisioned — nothing to nuke. Just
    // mark the session errored and return the account to the pool so the
    // candidate can retry the same invite without burning a second account.
    await markSession(sessionId, "error", String(e)).catch(() => {});
    await releaseAccount(accountId).catch(() => {});
  }
  return { ok: true };
}

async function runTeardownEnt({ sessionId }) {
  try {
    await teardown(sessionId);
  } catch (e) {
    // Never throw out of the worker — teardown failures are logged and left
    // for the reaper/ops to reconcile, not surfaced to the candidate (who has
    // already submitted and moved on).
    console.error(`[ent-worker] teardown failed ${sessionId}: ${e.message}`);
  }
  return { ok: true };
}

// Dispatch a worker action. In Lambda, fire it as a real async self-invoke
// (InvocationType: "Event") so the ~90s deploy / ~6min teardown never blocks
// the candidate-facing response. The dispatch call itself is AWAITED —
// fire-and-forget on the SDK promise risks the well-documented
// Runtime.NodeJsExit hazard where the execution environment can be frozen or
// recycled before the outbound InvokeCommand actually leaves the process.
// Locally (no AWS_LAMBDA_FUNCTION_NAME), there is no Lambda to self-invoke,
// so just run the same logic inline so local dev/testing works end to end.
async function invokeEntWorker(action, payload) {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    await entLambda.send(
      new InvokeCommand({
        FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: JSON.stringify({ _worker: true, action, ...payload }),
      })
    );
    return;
  }
  if (action === "deploy-ent") return runDeployEnt(payload);
  if (action === "teardown-ent") return runTeardownEnt(payload);
}

export async function handler(event) {
  // ── Worker path (invoked async by invokeEntWorker) ─────────────────────
  if (event._worker) {
    const { action } = event;
    if (action === "deploy-ent") {
      await runDeployEnt(event);
      return { ok: true };
    }
    if (action === "teardown-ent") {
      await runTeardownEnt(event);
      return { ok: true };
    }
    return { ok: true };
  }

  const method = (
    event.requestContext?.http?.method ??
    event.httpMethod ??
    "GET"
  ).toUpperCase();
  const path = event.rawPath ?? event.path ?? "/";

  // Shared-secret check. /health is always open. API GW header names arrive
  // lower-cased on v2 events.
  //
  // FAIL CLOSED in Lambda: the engine is internet-exposed via API Gateway, so a
  // missing/blank ENT_ENGINE_SECRET must NEVER silently disable auth. If we are in
  // the Lambda runtime with no secret configured, refuse every non-health request
  // as misconfigured rather than serving it unauthenticated. Locally (no Lambda) a
  // blank secret still means "guard disabled" for dev convenience only.
  const isHealth = method === "GET" && path === "/health";
  const secretSet = ENT_ENGINE_SECRET.trim().length > 0;
  if (!isHealth) {
    if (IN_LAMBDA && !secretSet) {
      console.error(
        "[ent-engine] ENT_ENGINE_SECRET is empty in the Lambda runtime; refusing all non-health requests (fail closed)"
      );
      return resp(500, { error: "server misconfigured" });
    }
    if (secretSet) {
      const h = event.headers ?? {};
      const supplied = h["x-engine-token"] ?? h["X-Engine-Token"] ?? "";
      if (!timingSafeEqual(supplied, ENT_ENGINE_SECRET)) {
        return resp(401, { error: "unauthorized" });
      }
    }
  }

  let parsed = {};
  try {
    if (event.body) {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString()
        : event.body;
      parsed = JSON.parse(raw);
    }
  } catch {}

  const qs = event.queryStringParameters ?? {};

  try {
    if (method === "GET" && path === "/health") {
      return resp(200, { ok: true, engine: "enterprise" });
    }

    // ── admin/org (called by ShieldSync admin UI) ─────────────────────────
    if (method === "POST" && path === "/ent/orgs") {
      const org = await createOrg(parsed);
      // Attributable audit trail (Batch L) - greppable structured line to
      // CloudWatch on this privileged mutation. `actor` is the authenticated admin
      // email the app passes through; null if not supplied.
      console.log(
        JSON.stringify({ audit: true, action: "org.create", actor: parsed.actor ?? null, orgId: org?.orgId ?? null, at: Date.now() })
      );
      return resp(200, org);
    }

    if (method === "GET" && path === "/ent/orgs") {
      const org = await getOrg(qs.orgId);
      if (!org) return resp(404, { error: "not found" });
      return resp(200, org);
    }

    // ShieldSync admin only (app enforces the admin gate before calling this).
    if (method === "GET" && path === "/ent/admin/orgs") {
      const orgs = await listAllOrgs();
      return resp(200, { orgs });
    }

    if (method === "POST" && path === "/ent/orgs/credits") {
      const { orgId, delta, actor } = parsed;
      const org = await addCredits(orgId, delta);
      // Attributable audit trail (Batch L) - every credit adjustment is logged with
      // the acting admin so a balance change is never anonymous. Immutable in
      // CloudWatch; no new table required.
      console.log(
        JSON.stringify({ audit: true, action: "credits.adjust", actor: actor ?? null, orgId, delta, at: Date.now() })
      );
      return resp(200, org);
    }

    if (method === "POST" && path === "/ent/orgs/delete") {
      const { orgId, actor } = parsed;
      const org = await getOrg(orgId);
      if (!org) return resp(404, { error: "not found" });
      // Refuse to delete an org that has assessments -- those carry candidate PII
      // and results and must never be orphaned. Only empty orgs (mistaken/test)
      // are deletable; anything with assessments must be handled via a proper
      // data-retention/erasure flow instead.
      const assessments = await listAssessments(orgId);
      if (Array.isArray(assessments) && assessments.length > 0) {
        return resp(409, { error: "ORG_NOT_EMPTY" });
      }
      await deleteOrg(orgId);
      console.log(
        JSON.stringify({ audit: true, action: "org.delete", actor: actor ?? null, orgId, at: Date.now() })
      );
      return resp(200, { ok: true });
    }

    // Data-subject erasure (DPDP / GDPR right to be forgotten). The app enforces
    // the ShieldSync-staff admin gate before calling this; the shared-secret gate
    // protects the route itself. Redacts the candidate's PII in place (see
    // eraseCandidatePii) and logs an attributable audit line.
    if (method === "POST" && path === "/ent/invites/erase") {
      const { inviteToken, actor } = parsed;
      if (!inviteToken) return resp(400, { error: "INVITE_TOKEN_REQUIRED" });
      const r = await eraseCandidatePii(inviteToken);
      if (!r.ok) return resp(404, { error: "INVITE_NOT_FOUND" });
      console.log(
        JSON.stringify({ audit: true, action: "candidate.erase", actor: actor ?? null, inviteToken, at: Date.now() })
      );
      return resp(200, { ok: true, erasedAt: r.erasedAt });
    }

    // ── employer portal (called by the enterprise app server-side) ────────
    if (method === "POST" && path === "/ent/assessments") {
      const { orgId, labSlug, name, hintsOn } = parsed;
      const assessment = await createAssessment({ orgId, labSlug, name, hintsOn });
      return resp(200, assessment);
    }

    if (method === "GET" && path === "/ent/assessments") {
      const assessments = await listAssessments(qs.orgId);
      return resp(200, { assessments });
    }

    if (method === "GET" && path === "/ent/assessment") {
      const assessment = await getAssessment(qs.assessmentId);
      if (!assessment) return resp(404, { error: "not found" });
      return resp(200, assessment);
    }

    if (method === "POST" && path === "/ent/invites") {
      const { assessmentId, orgId, candidateName, candidateEmail } = parsed;
      // inviteToken MUST be caller-supplied (the app mints it once via newToken()
      // and reuses it on retry) so the credit-ledger charge is idempotent. Minting
      // a fresh token here on a missing value would make a retried create a SECOND
      // charge, so reject instead. (Contract: the enterprise app now always sends
      // inviteToken on POST /ent/invites.)
      const inviteToken = parsed.inviteToken;
      if (!inviteToken || typeof inviteToken !== "string") {
        return resp(400, { error: "INVITE_TOKEN_REQUIRED" });
      }
      const result = await createInvite({ assessmentId, orgId, candidateName, candidateEmail, inviteToken });
      return resp(200, result);
    }

    if (method === "GET" && path === "/ent/invites") {
      const invites = await listInvites(qs.assessmentId);
      return resp(200, { invites });
    }

    if (method === "POST" && path === "/ent/invites/revoke") {
      const { inviteToken } = parsed;
      const invite = await revokeInvite(inviteToken);
      return resp(200, invite);
    }

    if (method === "POST" && path === "/ent/invites/refund") {
      const { inviteToken } = parsed;
      const refunded = await refundInvite(inviteToken);
      return resp(200, { refunded });
    }

    // ── candidate flow (safe subset — pure entinfra) ───────────────────────
    if (method === "GET" && path === "/ent/invite") {
      const invite = await getInvite(qs.inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      const assessment = await getAssessment(invite.assessmentId);
      const org = assessment ? await getOrg(assessment.orgId) : null;
      // Sanitized subset ONLY — never return otpHash, candidateEmail,
      // candidateReportToken, or any other invite's data.
      return resp(200, {
        status: invite.status,
        candidateName: invite.candidateName,
        assessmentId: invite.assessmentId,
        expiresAt: invite.expiresAt,
        otpLocked: invite.otpLocked,
        consentVersion: invite.consentVersion,
        name: assessment?.name,
        labSlug: assessment?.labSlug,
        hintsOn: assessment?.hintsOn,
        orgName: org?.name,
      });
    }

    if (method === "POST" && path === "/ent/consent") {
      const { inviteToken, consentVersion } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      try {
        const updated = await consentInvite(inviteToken, consentVersion);
        return resp(200, updated);
      } catch (e) {
        if (e.code === "NOT_CONSENTABLE") {
          return resp(409, { error: "NOT_CONSENTABLE", status: invite.status });
        }
        throw e;
      }
    }

    if (method === "POST" && path === "/ent/otp/send") {
      const { inviteToken } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      // Never send for a terminal invite - a revoked or already-submitted candidate
      // has no reason to receive a code.
      if (["revoked", "submitted"].includes(invite.status)) {
        return resp(409, { error: "NOT_SENDABLE", status: invite.status });
      }

      // Per-invite send throttle: 45s cooldown + rolling-24h daily cap. Both read
      // from counters on the invite that setOtp does NOT reset, so a resend loop
      // cannot bypass them.
      const nowSec = Math.floor(Date.now() / 1000);
      if (invite.otpLastSentAt && nowSec - invite.otpLastSentAt < OTP_SEND_COOLDOWN_SEC) {
        return resp(429, { error: "OTP_COOLDOWN", retryAfter: OTP_SEND_COOLDOWN_SEC - (nowSec - invite.otpLastSentAt) });
      }
      const windowStart = invite.otpSendWindowStart ?? 0;
      const inWindow = nowSec - windowStart < 24 * 3600;
      const priorCount = inWindow ? invite.otpSendCount ?? 0 : 0;
      if (priorCount >= OTP_SEND_DAILY_CAP) {
        return resp(429, { error: "OTP_DAILY_CAP" });
      }

      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      await setOtp(inviteToken, code, {
        lastSentAt: nowSec,
        windowStart: inWindow ? windowStart : nowSec,
        sendCount: priorCount + 1,
      });
      // Deliver the code by email via SES (Fix H). ENT_OTP_FROM must be an
      // SES-verified sender identity (and in the SES sandbox, the recipient must
      // be verified too). Never blocks the flow on a send failure — we report
      // `emailed` so ops can see delivery state.
      const from = process.env.ENT_OTP_FROM;
      let emailed = false;
      if (from && invite.candidateEmail) {
        try {
          await ses.send(
            new SendEmailCommand({
              Source: from,
              Destination: { ToAddresses: [invite.candidateEmail] },
              Message: {
                Subject: { Data: "Your ShieldSync assessment verification code" },
                Body: {
                  Text: { Data: `Your ShieldSync verification code is ${code}. It expires in 10 minutes. If you did not expect this, you can ignore it.` },
                  Html: {
                    Data: `<div style="font-family:system-ui,sans-serif;color:#0f172a"><p>Your ShieldSync assessment verification code:</p><p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#4f46e5">${code}</p><p style="color:#64748b">It expires in 10 minutes. If you did not expect this, you can ignore it.</p></div>`,
                  },
                },
              },
            })
          );
          emailed = true;
        } catch (e) {
          console.error("[ent/otp/send] SES send failed:", e.name, e.message);
        }
      }
      const out = { ok: true, emailed };
      // Return the plaintext code ONLY in local dev (never in the Lambda runtime,
      // regardless of whether a secret is set) - leaking it in prod would let anyone
      // who can reach the send endpoint read the OTP straight from the response.
      if (!IN_LAMBDA) out.devCode = code;
      return resp(200, out);
    }

    if (method === "POST" && path === "/ent/otp/verify") {
      const { inviteToken, code } = parsed;
      const result = await verifyOtp(inviteToken, code);
      // Expiry (#10) and state-machine (#4) guards surface as flags from verifyOtp;
      // map them to proper status codes. The normal {ok:true} / wrong-code /
      // locked / expired-code shapes still return 200 as before.
      if (result.linkExpired) return resp(410, { error: "LINK_EXPIRED" });
      if (result.notVerifiable) return resp(409, { error: "NOT_VERIFIABLE", status: result.status });
      return resp(200, result);
    }

    // ── reports (render /r/<token> and /r/c/<token>) ───────────────────────
    if (method === "GET" && path === "/ent/report") {
      const assessment = await getAssessmentByReportToken(qs.reportToken);
      if (!assessment) return resp(404, { error: "not found" });
      const results = await listResults(assessment.assessmentId);
      return resp(200, {
        assessment: { name: assessment.name, labSlug: assessment.labSlug, createdAt: assessment.createdAt },
        results,
      });
    }

    if (method === "GET" && path === "/ent/report/candidate") {
      const invite = await getInviteByCandidateReportToken(qs.candidateReportToken);
      if (!invite) return resp(404, { error: "not found" });
      const result = await getResult(invite.assessmentId, invite.inviteToken);
      return resp(200, { candidateName: invite.candidateName, result });
    }

    // ── orders/billing ──────────────────────────────────────────────────────
    if (method === "POST" && path === "/ent/orders") {
      const { orgId, invoiceNo, gstin, amountMinor, currency, credits } = parsed;
      const order = await createOrder({ orgId, invoiceNo, gstin, amountMinor, currency, credits });
      return resp(200, order);
    }

    if (method === "GET" && path === "/ent/orders") {
      const orders = await listOrders(qs.orgId);
      return resp(200, { orders });
    }

    if (method === "POST" && path === "/ent/orders/paid") {
      const { orderId } = parsed;
      const paid = await markOrderPaid(orderId);
      return resp(200, { paid });
    }

    // ── lab-leasing: reserved-capacity slot booking + timed assessment run ──
    if (method === "POST" && path === "/ent/slots") {
      const { inviteToken } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      const caps = await entReservedCounts();
      // capacity 0 => app shows "scheduling opens soon"; the app generates the
      // candidate-facing time grid client-side, /ent/book is the atomic guard.
      return resp(200, { capacity: caps.total, available: caps.available });
    }

    if (method === "POST" && path === "/ent/book") {
      const { inviteToken, slotKey } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      const bookable = ["verified", "consented", "booked"];
      if (!bookable.includes(invite.status)) {
        return resp(409, { error: "NOT_BOOKABLE" });
      }

      // Idempotent re-book of the SAME slot: the seat is already held for this
      // invite, so short-circuit BEFORE bookSlot - re-incrementing the counter would
      // let one invite consume multiple seats and exhaust the slot.
      if (invite.status === "booked" && invite.slotKey === slotKey) {
        return resp(200, { ok: true, slotKey });
      }

      const caps = await entReservedCounts();
      if (caps.total === 0) return resp(409, { error: "NO_ENTERPRISE_CAPACITY" });

      // Rebooking: release the previously-held seat first so its counter doesn't
      // leak (it would otherwise stay incremented on the old slot until TTL, falsely
      // shrinking that slot's availability).
      if (invite.status === "booked" && invite.slotKey && invite.slotKey !== slotKey) {
        await releaseSlot(invite.slotKey, inviteToken).catch(() => {});
      }

      const r = await bookSlot(slotKey, caps.total, inviteToken);
      if (!r.ok) return resp(409, { error: "SLOT_FULL" });

      await setInviteStatus(inviteToken, "booked", { slotKey, slotAt: slotKey });

      // Best-effort pre-warm so the candidate's Start is instant at their slot.
      // Warming is an optimization, not correctness — never fail the booking.
      try {
        const assessment = await getAssessment(invite.assessmentId);
        if (assessment?.labSlug) await ensureWarmEnt(assessment.labSlug);
      } catch (e) {
        console.error("[ent/book] pre-warm failed (non-fatal):", e.message);
      }

      return resp(200, { ok: true, slotKey });
    }

    if (method === "POST" && path === "/ent/start") {
      const { inviteToken } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      // "started" is allowed too — that's the reconnect path below, not a fresh lease.
      if (!["booked", "started"].includes(invite.status)) {
        return resp(409, { error: "NOT_STARTABLE" });
      }

      // ── Idempotent reconnect (crash-resume): never lease a 2nd account ──
      if (invite.sessionId) {
        const s = await getSession(invite.sessionId);
        if (s && ["leasing", "active"].includes(s.status) && new Date(s.expiresAt) > new Date()) {
          const assessment = await getAssessment(invite.assessmentId);
          const consoleUrl = await mintConsoleUrl({
            accountId: s.accountId,
            labSlug: assessment?.labSlug,
            durationSeconds: 3600,
          });
          return resp(200, {
            sessionId: s.sessionId,
            status: s.status,
            consoleUrl,
            expiresAt: s.expiresAt,
            reconnected: true,
          });
        }
      }

      // ── Fresh start ──────────────────────────────────────────────────
      const assessment = await getAssessment(invite.assessmentId);
      const labSlug = assessment?.labSlug;
      const entUserId = "ent:" + inviteToken;

      let lease;
      try {
        lease = await leaseEnt(entUserId, labSlug, ENT_TIMEBOX_MIN + ENT_GRACE_MIN);
      } catch (e) {
        if (e.message === "NO_CAPACITY") return resp(503, { error: "NO_CAPACITY", retry: true });
        throw e;
      }

      const scoredExpiresAt = new Date(Date.now() + ENT_TIMEBOX_MIN * 60000).toISOString();
      // Persist onto the invite so /ent/submit can grade before teardown —
      // the account is wiped right after grading, so this is the last chance
      // to know which account/role to grade against.
      await setInviteStatus(inviteToken, "started", {
        sessionId: lease.sessionId,
        accountId: lease.accountId,
        execRoleArn: lease.execRoleArn,
        consumedCompute: true,
        startedAt: new Date().toISOString(),
        scoredExpiresAt,
      });

      if (!lease.warm) {
        // Cold account: dispatch the deploy worker; session stays "leasing"
        // until the worker flips it to "active". The app polls for status.
        await invokeEntWorker("deploy-ent", {
          sessionId: lease.sessionId,
          accountId: lease.accountId,
          labSlug,
          execRoleArn: lease.execRoleArn,
        });
      }

      const consoleUrl = await mintConsoleUrl({
        accountId: lease.accountId,
        labSlug,
        durationSeconds: 3600,
      });

      return resp(200, {
        sessionId: lease.sessionId,
        status: lease.warm ? "active" : "leasing",
        warm: lease.warm,
        consoleUrl,
        scoredExpiresAt,
        expiresAt: lease.expiresAt,
      });
    }

    if (method === "POST" && path === "/ent/submit") {
      const { inviteToken, reflection } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });

      // Idempotent: a double-submit (e.g. timer auto-submit racing a manual
      // click) returns the already-computed result instead of re-grading a
      // torn-down account.
      if (invite.status === "submitted") {
        const existing = await getResult(invite.assessmentId, inviteToken);
        return resp(200, { ok: true, submitted: true, result: existing });
      }
      if (invite.status !== "started") {
        return resp(409, { error: "NOT_SUBMITTABLE" });
      }

      const assessment = await getAssessment(invite.assessmentId);
      const labSlug = assessment?.labSlug;
      if (!labSlug || !invite.sessionId || !invite.accountId || !invite.execRoleArn) {
        return resp(409, { error: "NO_ACTIVE_SESSION" });
      }

      // Timebox check (Batch E): flag a submit that lands after the 60-min scored
      // window so a 70-minute attempt is never silently recorded as on-time. We
      // still accept + grade the submit, but record that it was late.
      const nowMs = Date.now();
      const scoredExpMs = invite.scoredExpiresAt ? new Date(invite.scoredExpiresAt).getTime() : NaN;
      const lateSubmit = Number.isFinite(scoredExpMs) && nowMs > scoredExpMs;
      const secondsLate = lateSubmit ? Math.round((nowMs - scoredExpMs) / 1000) : 0;

      // Clamp candidate-controlled reflection BEFORE grading/persisting so an
      // oversized field can't blow the DynamoDB item-size limit and make putResult
      // throw (which would otherwise strand the leased account until the reaper).
      const reflectionText =
        typeof reflection === "string" ? reflection.slice(0, REFLECTION_MAX_CHARS) : null;

      try {
        // GRADE FIRST - the account gets wiped by teardown right after this, so
        // grading must happen while the account is still live.
        let grade;
        let gradeError;
        try {
          grade = await gradeLab(labSlug, invite.execRoleArn, invite.accountId);
        } catch (e) {
          // Log the FULL detail (embeds platform account id + role ARNs) to
          // CloudWatch ONLY; persist a FIXED string into the candidate result the
          // employer sees. Never let the raw error text reach the stored report.
          console.error("[ent/submit] gradeLab failed:", e);
          gradeError = "grading_incomplete";
          grade = { gradable: false, criteria: [], passed: false };
        }

        // MVP scoring: correctness with partial credit via pass ratio. Other
        // dimensions (quality/speed/process/reflection/integrity) are enriched
        // by later async workers (see TODO below) and stay "pending" until then.
        const crit = grade.criteria || [];
        const total = crit.length;
        const passed = crit.filter((c) => c.passed && !c.unknown).length;
        const correctness = total ? Math.round(55 * (passed / total)) : 0;
        const composite = correctness;

        const report = {
          composite,
          correctness,
          dims: { quality: "pending", speed: "pending", process: "pending", reflection: "pending" },
          criteria: crit,
          passedCount: passed,
          totalCriteria: total,
          reflectionText,
          reflectionScore: null,
          integrity: "pending",
          lateSubmit,
          secondsLate,
          scoredExpiresAt: invite.scoredExpiresAt ?? null,
          gradedAt: new Date().toISOString(),
          ...(gradeError ? { gradeError } : {}),
        };

        await putResult(invite.assessmentId, inviteToken, report);
        await setInviteStatus(inviteToken, "submitted", {
          submittedAt: new Date().toISOString(),
          lateSubmit,
        });

        // TODO: async workers for (a) CloudTrail work-timeline ~15min post-submit
        // [Fix F], (b) Gemini reflection scoring [Fix I]. integrity + reflectionScore
        // stay "pending" until then.

        return resp(200, { ok: true, submitted: true, lateSubmit });
      } finally {
        // ALWAYS reclaim the leased AWS account, even if grading or putResult threw:
        // otherwise the account leaks until the 75-min reaper. Teardown is async
        // (~6min nuke) and best-effort; a dispatch failure is logged, never masks the
        // real error, and never blocks the candidate's response.
        await invokeEntWorker("teardown-ent", { sessionId: invite.sessionId }).catch((e) => {
          console.error("[ent/submit] teardown dispatch failed:", e?.message);
        });
      }
    }

    return resp(404, { error: "NOT_FOUND" });
  } catch (e) {
    // Full detail (may embed AWS account id, ARNs, table names) goes to CloudWatch
    // ONLY. The HTTP caller gets an opaque error - never String(e) / stack /
    // e.message. The specific codes below are fixed, safe strings.
    console.error("ent-engine error:", e);
    if (e.code === "NO_CREDITS") return resp(402, { error: "NO_CREDITS" });
    if (e.code === "INVITE_NOT_FOUND") return resp(404, { error: "INVITE_NOT_FOUND" });
    return resp(500, { error: "INTERNAL" });
  }
}
