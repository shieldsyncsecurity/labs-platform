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
  newToken,
  hashOtp,
  createOrg,
  getOrg,
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
  refundInvite,
  revokeInvite,
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
import { randomInt } from "node:crypto";

// Scored time-box for an enterprise assessment attempt (MVP: fixed for all
// labs; per-lab override can come later from assessment/lab config). Lease
// TTL = timebox + grace so a crash/reconnect mid-attempt and the post-submit
// reflection step both have headroom before the account auto-expires.
const ENT_TIMEBOX_MIN = 60;
const ENT_GRACE_MIN = 15;

const entLambda = new LambdaClient({ region: "us-east-1" });

// Shared-secret guard for the public HTTP surface (set via Lambda env). The
// enterprise app sends this in the X-Engine-Token header; without it the
// engine refuses non-health requests. Empty string in local dev = guard
// disabled — mirrors handler.mjs's ENGINE_SHARED_SECRET exactly.
const ENT_ENGINE_SECRET = process.env.ENT_ENGINE_SECRET || "";

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

  // Shared-secret check (skipped for /health and when no secret is configured,
  // i.e. local dev). API GW header names arrive lower-cased on v2 events.
  if (ENT_ENGINE_SECRET && !(method === "GET" && path === "/health")) {
    const h = event.headers ?? {};
    const supplied = h["x-engine-token"] ?? h["X-Engine-Token"] ?? "";
    if (!timingSafeEqual(supplied, ENT_ENGINE_SECRET)) {
      return resp(401, { error: "unauthorized" });
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
      const { orgId, delta } = parsed;
      const org = await addCredits(orgId, delta);
      return resp(200, org);
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
      const inviteToken = parsed.inviteToken || newToken();
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
      const invite = await setInviteStatus(inviteToken, "consented", {
        consentVersion,
        consentAt: new Date().toISOString(),
      });
      return resp(200, invite);
    }

    if (method === "POST" && path === "/ent/otp/send") {
      const { inviteToken } = parsed;
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      await setOtp(inviteToken, code);
      // TODO: dispatch SES email with the code (Fix H)
      const out = { ok: true };
      if (!ENT_ENGINE_SECRET) out.devCode = code; // dev-only: no secret configured
      return resp(200, out);
    }

    if (method === "POST" && path === "/ent/otp/verify") {
      const { inviteToken, code } = parsed;
      const result = await verifyOtp(inviteToken, code);
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

      // GRADE FIRST — the account gets wiped by teardown right after this,
      // so grading must happen while the account is still live.
      let grade;
      let gradeError;
      try {
        grade = await gradeLab(labSlug, invite.execRoleArn, invite.accountId);
      } catch (e) {
        gradeError = String(e);
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
        reflectionText: reflection ?? null,
        reflectionScore: null,
        integrity: "pending",
        gradedAt: new Date().toISOString(),
        ...(gradeError ? { gradeError } : {}),
      };

      await putResult(invite.assessmentId, inviteToken, report);
      await setInviteStatus(inviteToken, "submitted", { submittedAt: new Date().toISOString() });

      // Teardown is async (~6min nuke) — never block the candidate's response on it.
      await invokeEntWorker("teardown-ent", { sessionId: invite.sessionId });

      // TODO: async workers for (a) CloudTrail work-timeline ~15min post-submit
      // [Fix F], (b) Gemini reflection scoring [Fix I]. integrity + reflectionScore
      // stay "pending" until then.

      return resp(200, { ok: true, submitted: true });
    }

    return resp(404, { error: "NOT_FOUND" });
  } catch (e) {
    console.error("ent-engine error:", e);
    if (e.code === "NO_CREDITS") return resp(402, { error: "NO_CREDITS" });
    if (e.code === "INVITE_NOT_FOUND") return resp(404, { error: "INVITE_NOT_FOUND" });
    return resp(500, { error: e.code || e.message });
  }
}
