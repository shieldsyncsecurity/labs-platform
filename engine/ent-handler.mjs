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
  updateAssessment,
  createInvite,
  getInvite,
  getInviteByCandidateReportToken,
  listInvites,
  setInviteStatus,
  consentInvite,
  refundInvite,
  revokeInvite,
  stampInviteResend,
  eraseCandidatePii,
  revokeAssessmentReport,
  renewAssessmentReport,
  revokeCandidateReport,
  renewCandidateReport,
  stampLowCreditNotified,
  appendProblem,
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
  createAgreement,
  getAgreement,
  listAgreements,
  updateAgreementDraft,
  issueAgreement,
  markAgreementSuperseded,
  acceptAgreement,
  voidAgreement,
  setOrgAcceptedAgreement,
  appendAudit,
  listAudit,
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
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { chmod } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomInt } from "node:crypto";

// aws-nuke binary bootstrap — IDENTICAL to handler.mjs (the B2C engine). The
// 287 MB binary is too large to bundle, so it lives in the deploy bucket and is
// streamed to /tmp/aws-nuke at container cold-start. teardown() in labinfra
// spawns /tmp/aws-nuke; without this download the ent engine's teardown failed
// with `spawn /tmp/aws-nuke ENOENT` and every ent-leased account leaked
// (root cause: the bootstrap was never ported to this separate Lambda file).
const DEPLOY_BUCKET = "shieldsync-engine-deploy-750294427884";
const NUKE_TMP = "/tmp/aws-nuke";
const nukeReady = process.env.AWS_LAMBDA_FUNCTION_NAME
  ? (async () => {
      const s3 = new S3Client({ region: "us-east-1" });
      const { Body } = await s3.send(new GetObjectCommand({ Bucket: DEPLOY_BUCKET, Key: "aws-nuke-linux" }));
      const ws = createWriteStream(NUKE_TMP);
      await pipeline(Body, ws);
      await chmod(NUKE_TMP, 0o755);
      console.log("[ent-init] aws-nuke downloaded to /tmp");
    })().catch((e) => { console.error("[ent-init] aws-nuke download failed:", e.message); throw e; })
  : Promise.resolve();

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

// Per-invite cooldown between magic-link resends (W3B-3). Mirrors the OTP send
// cooldown: a resendLastAt stamp on the invite bounds how often the SAME invite
// can trigger an SES send, resisting cost/spam abuse. Resend NEVER charges a
// credit (unlike POST /ent/invites).
const INVITE_RESEND_COOLDOWN_SEC = 45;

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

// Ops inbox for internal notifications (low-credit alerts, candidate disputes).
const OPS_EMAIL = "info@shieldsyncsecurity.com";

// sendOpsEmail(): short plain-text SES email to the ops inbox, same from-address
// + client as the OTP sends. STRICTLY best-effort: a send failure is logged and
// swallowed -- it must NEVER fail the parent operation (invite charge, problem
// report). Returns whether the send succeeded so callers can report `emailed`.
async function sendOpsEmail(subject, text) {
  const from = process.env.ENT_OTP_FROM;
  if (!from) return false;
  try {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [OPS_EMAIL] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: text } },
        },
      })
    );
    return true;
  } catch (e) {
    console.error("[ent] ops email send failed:", e.name, e.message);
    return false;
  }
}

// cleanActor(): sanitize the caller-supplied audit identity (E9). The app injects
// the staff email server-side; clamp to a short plain string and fall back so
// existing callers that don't send it keep working.
function cleanActor(v, fallback = "admin") {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : fallback;
}

// audit(): best-effort durable audit write (W3B-1). Wraps entinfra.appendAudit so
// a failed audit write can NEVER fail the parent mutation -- the console.log audit
// line beside each call is the immediate CloudWatch record; this table is the
// queryable permanent one the admin Activity panel reads. Logged + swallowed on
// failure, exactly like sendOpsEmail.
async function audit(entry) {
  try {
    await appendAudit(entry);
  } catch (e) {
    console.error("[ent] durable audit write failed (non-fatal):", e.name, e.message);
  }
}

// sendInviteLinkEmail(): send a candidate their personal magic-link email via SES.
// Shared by POST /ent/invites (first successful create) and POST /ent/invites/resend
// (W3B-3) so the two paths never drift. Best-effort: returns whether the send
// succeeded; a failure is logged and swallowed (never fails the parent op). The
// link host is ALWAYS our own pinned origin (env ENT_APP_URL override) -- caller
// input never controls it (anti-phishing), and candidateName is HTML-escaped.
async function sendInviteLinkEmail({ candidateEmail, candidateName, inviteToken }) {
  const from = process.env.ENT_OTP_FROM;
  if (!from || !candidateEmail) return false;
  const appOrigin = (process.env.ENT_APP_URL || "https://enterprise.shieldsyncsecurity.com").replace(/\/+$/, "");
  const link = `${appOrigin}/a/${inviteToken}`;
  const rawWho = typeof candidateName === "string" && candidateName.trim() ? candidateName.trim() : "there";
  const who = rawWho.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  try {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [candidateEmail] },
        Message: {
          Subject: { Data: "Your ShieldSync cloud security assessment" },
          Body: {
            Text: {
              Data: `Hi ${rawWho},\n\nYou've been invited to complete a ShieldSync cloud security assessment -- a short, hands-on exercise in a real, isolated cloud environment. It's a live scenario to secure, not a quiz, and your work is assessed automatically.\n\nWhat to expect:\n  - Runs in your browser; nothing to install.\n  - Timed once you begin, so start when you can focus.\n  - Your progress is saved as you go.\n\nStart your assessment:\n${link}\n\nThis link is personal to you -- please don't share it. If you weren't expecting this, you can safely ignore this email.\n\nGood luck,\nThe ShieldSync team`,
            },
            Html: {
              Data: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:8px"><div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;color:#0a1020;padding:4px 0 18px">Shield<span style="color:#d97706">Sync</span></div><p style="font-size:15px;line-height:1.55;margin:0 0 14px">Hi ${who},</p><p style="font-size:15px;line-height:1.55;margin:0 0 16px">You've been invited to complete a <strong>ShieldSync cloud security assessment</strong> -- a short, hands-on exercise in a real, isolated cloud environment. It's a live scenario to secure, not a quiz, and your work is assessed automatically.</p><div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;margin:0 0 20px"><p style="font-size:13px;font-weight:700;color:#9a3412;margin:0 0 8px">What to expect</p><ul style="font-size:13px;line-height:1.55;color:#7c2d12;margin:0;padding-left:18px"><li>Runs in your browser -- nothing to install.</li><li>Timed once you begin, so start when you can focus.</li><li>Your progress is saved as you go.</li></ul></div><a href="${link}" style="display:inline-block;background:#d97706;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Start your assessment</a><p style="font-size:12px;line-height:1.5;color:#64748b;margin:18px 0 0">Or paste this link into your browser:<br/><span style="color:#475569">${link}</span></p><p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:14px 0 0">This link is personal to you -- please don't share it. If you weren't expecting this, you can safely ignore this email.</p></div>`,
            },
          },
        },
      })
    );
    return true;
  } catch (e) {
    console.error("[ent/invites] invite email send failed:", e.name, e.message);
    return false;
  }
}

// -- Agreements (W3-2) input hygiene ------------------------------------------
//
// bodyText is the full rendered legal snapshot; 200_000 chars is the hard
// server-side cap (well under the 400KB DynamoDB item limit for the ASCII text
// the templates produce). Params are allowlisted to the W3-1 schema keys and
// clamped, so an arbitrary caller payload can never balloon the stored row.
const AGREEMENT_BODY_MAX = 200000;
const AGREEMENT_PARAM_KEYS = [
  "companyLegalName",
  "registeredAddress",
  "gstin",
  "signatoryName",
  "signatoryTitle",
  "effectiveDate",
  "governingLaw",
];

// cleanAgreementParams(): keep only the known param keys, as trimmed strings
// clamped to a sane length. Unknown keys and non-string values are dropped.
function cleanAgreementParams(v) {
  const out = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const k of AGREEMENT_PARAM_KEYS) {
      if (typeof v[k] === "string" && v[k].trim()) out[k] = v[k].trim().slice(0, 500);
    }
  }
  return out;
}

// cleanEmail(): sanitize a caller-supplied email for acceptedBy -- trimmed,
// clamped to RFC 5321's 254-char address ceiling. Empty string when unusable.
function cleanEmail(v) {
  return typeof v === "string" ? v.trim().slice(0, 254) : "";
}

// reportDead(): report-token lifecycle check (E1). Revocation always wins; a
// missing expiry field (rows created before the field existed) means valid.
function reportDead(revokedAt, expiresAt) {
  if (revokedAt) return true;
  if (expiresAt && new Date(expiresAt) < new Date()) return true;
  return false;
}

// E3: invite status -> employer-facing roster label. `expired` is the same
// expiresAt test the candidate endpoints 410 on; a submitted attempt is final
// and never relabeled Expired.
function rosterLabel(status, expired) {
  if (status === "submitted") return "Submitted";
  if (expired) return "Expired";
  if (status === "started") return "In progress";
  if (status === "booked") return "Scheduled";
  return "Invited"; // created / consented / verified
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
    await nukeReady; // ensure /tmp/aws-nuke exists before teardown spawns it
    await teardown(sessionId);
  } catch (e) {
    // Never throw out of the worker — teardown failures are logged and left
    // for the reaper/ops to reconcile, not surfaced to the candidate (who has
    // already submitted and moved on).
    console.error(`[ent-worker] teardown failed ${sessionId}: ${e.message}`);
  }
  return { ok: true };
}

async function runWarmEnt({ labSlug }) {
  // Pre-warm the reserved pool for a booked slot. This CloudFormation deploy
  // takes ~90s and MUST run in its own async invocation — awaiting it inline in
  // the /ent/book HTTP handler blew the API Gateway 30s integration timeout
  // (candidate saw 503 while the warm kept running + occupied the account).
  try {
    if (labSlug) await ensureWarmEnt(labSlug);
  } catch (e) {
    console.error(`[ent-worker] warm failed ${labSlug}: ${e.message}`);
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
  if (action === "warm-ent") return runWarmEnt(payload);
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
    if (action === "warm-ent") {
      await runWarmEnt(event);
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
      const actor = cleanActor(parsed.actor);
      // Attributable audit trail (Batch L / E9) - greppable structured line to
      // CloudWatch on this privileged mutation. `actor` is the staff email the app
      // injects server-side; sanitized, defaulting to "admin" for legacy callers.
      // The durable audit (W3B-1) mirrors it into ShieldSyncEntAudit, best-effort.
      console.log(
        JSON.stringify({ audit: true, action: "org.create", actor, orgId: org?.orgId ?? null, at: Date.now() })
      );
      await audit({ orgId: org?.orgId, actor, action: "org.create", target: org?.orgId, detail: { name: org?.name ?? "" } });
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
      const actor = cleanActor(parsed.actor);
      // Optional free-text reason (E9) for the audit trail -- clamped, never stored
      // in DynamoDB, only in the immutable CloudWatch audit line.
      const reason =
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 300)
          : null;
      const org = await addCredits(orgId, delta);
      // Attributable audit trail (Batch L / E9) - every credit adjustment is logged
      // with the acting staff email + reason so a balance change is never anonymous.
      // Immutable in CloudWatch; mirrored into the durable audit table (W3B-1).
      console.log(
        JSON.stringify({ audit: true, action: "credits.adjust", actor, reason, orgId, delta, at: Date.now() })
      );
      await audit({ orgId, actor, action: "credits.adjust", target: orgId, detail: { delta, reason } });
      return resp(200, org);
    }

    if (method === "POST" && path === "/ent/orgs/delete") {
      const { orgId } = parsed;
      const actor = cleanActor(parsed.actor);
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
        JSON.stringify({ audit: true, action: "org.delete", actor, orgId, at: Date.now() })
      );
      await audit({ orgId, actor, action: "org.delete", target: orgId, detail: { name: org?.name ?? "" } });
      return resp(200, { ok: true });
    }

    // Data-subject erasure (DPDP / GDPR right to be forgotten). The app enforces
    // the ShieldSync-staff admin gate before calling this; the shared-secret gate
    // protects the route itself. Redacts the candidate's PII in place (see
    // eraseCandidatePii) and logs an attributable audit line.
    if (method === "POST" && path === "/ent/invites/erase") {
      const { inviteToken } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!inviteToken) return resp(400, { error: "INVITE_TOKEN_REQUIRED" });
      const r = await eraseCandidatePii(inviteToken);
      if (!r.ok) return resp(404, { error: "INVITE_NOT_FOUND" });
      console.log(
        JSON.stringify({ audit: true, action: "candidate.erase", actor, inviteToken, at: Date.now() })
      );
      // orgId is untouched by the erase (only name/email/reflection are redacted),
      // so a post-erase read gives the org to index this audit under.
      const erasedInvite = await getInvite(inviteToken);
      await audit({ orgId: erasedInvite?.orgId, actor, action: "candidate.erase", target: inviteToken, detail: {} });
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

    // W3B-4: rename an assessment / toggle hints. Existence is checked via the
    // entinfra ConditionExpression (404 on a bad id); ORG-OWNERSHIP is verified
    // APP-SIDE before this is called (the portal re-checks the assessment's orgId
    // against the session org), matching the report/agreement portal contract.
    if (method === "POST" && path === "/ent/assessments/update") {
      const { assessmentId } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!assessmentId || typeof assessmentId !== "string") {
        return resp(400, { error: "ASSESSMENT_ID_REQUIRED" });
      }
      const patch = {};
      if (parsed.name !== undefined) {
        if (typeof parsed.name !== "string") return resp(400, { error: "NAME_INVALID" });
        patch.name = parsed.name.trim().slice(0, 200);
      }
      if (parsed.hintsOn !== undefined) patch.hintsOn = parsed.hintsOn === true;
      if (Object.keys(patch).length === 0) return resp(400, { error: "NOTHING_TO_UPDATE" });
      const assessment = await updateAssessment(assessmentId, patch);
      if (!assessment) return resp(404, { error: "not found" });
      console.log(
        JSON.stringify({ audit: true, action: "assessment.update", actor, assessmentId, fields: Object.keys(patch), at: Date.now() })
      );
      await audit({ orgId: assessment.orgId, actor, action: "assessment.update", target: assessmentId, detail: { fields: Object.keys(patch) } });
      return resp(200, assessment);
    }

    if (method === "POST" && path === "/ent/invites") {
      const { assessmentId, orgId, candidateName, candidateEmail, sendLink, appUrl } = parsed;
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
      // Optionally email the candidate their personal magic link (employer opted
      // in). Best-effort: NEVER fail invite creation on a send error (the credit
      // is already spent and the link still works via copy) -- report `emailed`
      // so the UI can tell the employer whether to send it themselves. In the SES
      // sandbox this only reaches verified recipients.
      // Send ONLY on the first successful create (an idempotent replay must not
      // re-email). sendInviteLinkEmail pins our own app origin and HTML-escapes
      // the name -- appUrl (caller input) is deliberately IGNORED so a leaked
      // engine secret can't turn SES into a phishing sender from our identity.
      let emailed = false;
      if (result.creditConsumed && sendLink) {
        emailed = await sendInviteLinkEmail({ candidateEmail, candidateName, inviteToken });
      }
      // Low-credit trigger (E5): after a SUCCESSFUL charge (never on an idempotent
      // replay), check whether this charge pushed usage to >=80%. The conditional
      // stamp in stampLowCreditNotified makes concurrent crossers race to exactly
      // one winner, and only the winner emails ops. Entirely best-effort -- a
      // failure here must never fail the invite that was just created.
      if (result.creditConsumed) {
        try {
          const org = await getOrg(orgId);
          const total = Number(org?.creditsTotal) || 0;
          const used = Number(org?.creditsUsed) || 0;
          if (org && total > 0 && used / total >= 0.8 && !org.lowCreditNotifiedAt) {
            const won = await stampLowCreditNotified(orgId);
            if (won) {
              await sendOpsEmail(
                "ShieldSync Enterprise: org low on credits",
                `Org "${org.name || orgId}" (${orgId}) has used ${used} of ${total} credits (>=80%).\n\nConsider reaching out about a top-up.`
              );
            }
          }
        } catch (e) {
          console.error("[ent/invites] low-credit check failed (non-fatal):", e.message);
        }
      }
      return resp(200, { ...result, emailed });
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

    // W3B-3: re-send a candidate's magic-link email. NEVER charges a credit (a
    // resend re-delivers the SAME link, no new invite/ledger interaction). Reuses
    // the create-path SES block via sendInviteLinkEmail, throttled per-invite by a
    // resendLastAt cooldown (mirrors the OTP send cooldown). The app only offers
    // this for non-terminal invites; the engine enforces the same fail-closed.
    if (method === "POST" && path === "/ent/invites/resend") {
      const { inviteToken } = parsed;
      if (!inviteToken || typeof inviteToken !== "string") {
        return resp(400, { error: "INVITE_TOKEN_REQUIRED" });
      }
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      // Terminal invites have no live link to receive -- a revoked / submitted /
      // refunded candidate must never be re-emailed.
      if (["revoked", "submitted", "refunded"].includes(invite.status)) {
        return resp(409, { error: "NOT_RESENDABLE", status: invite.status });
      }
      // Per-invite cooldown (whitelisted RESEND_COOLDOWN code for the app UI).
      const nowSec = Math.floor(Date.now() / 1000);
      if (invite.resendLastAt && nowSec - invite.resendLastAt < INVITE_RESEND_COOLDOWN_SEC) {
        return resp(429, { error: "RESEND_COOLDOWN", retryAfter: INVITE_RESEND_COOLDOWN_SEC - (nowSec - invite.resendLastAt) });
      }
      // No candidate email on file -> nothing to resend (a copy-link-only invite).
      if (!invite.candidateEmail) return resp(400, { error: "NO_CANDIDATE_EMAIL" });
      // Stamp the cooldown BEFORE the send (like setOtp) so a send that fails at
      // SES still throttles the next attempt.
      await stampInviteResend(inviteToken);
      const emailed = await sendInviteLinkEmail({
        candidateEmail: invite.candidateEmail,
        candidateName: invite.candidateName,
        inviteToken,
      });
      return resp(200, { ok: true, emailed });
    }

    // ── candidate flow (safe subset — pure entinfra) ───────────────────────
    if (method === "GET" && path === "/ent/invite") {
      const invite = await getInvite(qs.inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      const assessment = await getAssessment(invite.assessmentId);
      const org = assessment ? await getOrg(assessment.orgId) : null;
      // Sanitized subset ONLY — never return otpHash, candidateEmail,
      // candidateReportToken, or any other invite's data. slotKey (E7) is set
      // once booked so a resumed candidate sees their scheduled slot; undefined
      // before booking (JSON.stringify drops it).
      return resp(200, {
        status: invite.status,
        candidateName: invite.candidateName,
        assessmentId: invite.assessmentId,
        expiresAt: invite.expiresAt,
        otpLocked: invite.otpLocked,
        consentVersion: invite.consentVersion,
        slotKey: invite.slotKey,
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
      // Consent is a hard precondition (verify already enforces it via a CAS; we
      // also gate the SEND so no OTP email dispatches before the candidate has
      // consented to data processing). A "created" invite must consent first.
      if (!["consented", "verified"].includes(invite.status)) {
        return resp(409, { error: "CONSENT_REQUIRED", status: invite.status });
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
      // Two access paths: reportToken = the shareable link, lifecycle-enforced
      // (E1); assessmentId = internal server-side callers (portal/admin pages
      // behind the engine secret + their own org/staff gates). Internal access
      // must keep working after a share link is revoked or expires -- the org
      // must never lose its OWN scores by killing a forwarded link.
      let assessment = null;
      if (qs.reportToken) {
        assessment = await getAssessmentByReportToken(qs.reportToken);
        // Lifecycle check (E1): a revoked or expired report link returns the SAME
        // 404 body as a never-existed token -- no oracle for which case it was.
        if (!assessment || reportDead(assessment.reportRevokedAt, assessment.reportExpiresAt)) {
          return resp(404, { error: "not found" });
        }
      } else if (qs.assessmentId) {
        assessment = await getAssessment(qs.assessmentId);
        if (!assessment) return resp(404, { error: "not found" });
      } else {
        return resp(404, { error: "not found" });
      }
      const results = await listResults(assessment.assessmentId);
      // Attach each candidate's name -- the employer report is the hiring team's
      // deliverable, and ranking anonymized tokens is useless for a decision.
      // Names come from the invite rows (already redacted on an erased invite).
      const invites = await listInvites(assessment.assessmentId);
      const nameByToken = {};
      // Full roster (E3): one row per non-revoked invite with an employer-facing
      // status label, so the report shows who has NOT finished, not just scores.
      // candidateReportToken rides ONLY on submitted rows (the per-candidate link
      // the employer can forward); the org-level token they already hold.
      const rosterNow = new Date();
      const roster = [];
      for (const inv of invites) {
        if (inv.inviteToken) nameByToken[inv.inviteToken] = inv.candidateName;
        // Revoked = employer killed the link; refunded = voided + credited back.
        // Neither belongs on the hiring roster.
        if (inv.status === "revoked" || inv.status === "refunded") continue;
        const expired =
          inv.status !== "submitted" && inv.expiresAt && new Date(inv.expiresAt) < rosterNow;
        // SECURITY: never emit the full inviteToken here -- it is the candidate's
        // live bearer credential (/a/<token>), and this response reaches anyone
        // holding the forwarded report link. The 8-char prefix is display/join-only.
        const row = {
          id: (inv.inviteToken || "").slice(0, 8),
          candidateName: inv.candidateName,
          status: rosterLabel(inv.status, expired),
          createdAt: inv.createdAt,
        };
        if (inv.slotKey) row.slotKey = inv.slotKey;
        if (inv.status === "submitted") {
          row.submittedAt = inv.submittedAt;
          row.candidateReportToken = inv.candidateReportToken;
        }
        roster.push(row);
      }
      const named = results.map((r) => ({ ...r, candidateName: nameByToken[r.inviteToken] }));
      return resp(200, {
        assessment: { name: assessment.name, labSlug: assessment.labSlug, createdAt: assessment.createdAt },
        results: named,
        roster,
      });
    }

    if (method === "GET" && path === "/ent/report/candidate") {
      const invite = await getInviteByCandidateReportToken(qs.candidateReportToken);
      // Same E1 lifecycle check as /ent/report -- revoked (incl. via an erasure
      // cascade, E2) or expired is indistinguishable from never-existed.
      if (!invite || reportDead(invite.candidateReportRevokedAt, invite.candidateReportExpiresAt)) {
        return resp(404, { error: "not found" });
      }
      const result = await getResult(invite.assessmentId, invite.inviteToken);
      return resp(200, { candidateName: invite.candidateName, result });
    }

    // Report-token lifecycle admin (E1): revoke kills the link now; renew clears
    // a revoke and extends validity to now + 90d. Target is EITHER the employer
    // report (assessmentId) or a candidate report (inviteToken). The app enforces
    // org ownership / staff gate before calling these.
    if (method === "POST" && path === "/ent/report/revoke") {
      const { assessmentId, inviteToken } = parsed;
      const actor = cleanActor(parsed.actor);
      if (assessmentId) {
        const a = await revokeAssessmentReport(assessmentId);
        if (!a) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "report.revoke", actor, assessmentId, at: Date.now() })
        );
        await audit({ orgId: a.orgId, actor, action: "report.revoke", target: assessmentId, detail: { kind: "assessment" } });
        return resp(200, { ok: true, revokedAt: a.reportRevokedAt });
      }
      if (inviteToken) {
        const inv = await revokeCandidateReport(inviteToken);
        if (!inv) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "report.revoke", actor, inviteToken, at: Date.now() })
        );
        await audit({ orgId: inv.orgId, actor, action: "report.revoke", target: inviteToken, detail: { kind: "candidate" } });
        return resp(200, { ok: true, revokedAt: inv.candidateReportRevokedAt });
      }
      return resp(400, { error: "TARGET_REQUIRED" });
    }

    if (method === "POST" && path === "/ent/report/renew") {
      const { assessmentId, inviteToken } = parsed;
      const actor = cleanActor(parsed.actor);
      if (assessmentId) {
        const a = await renewAssessmentReport(assessmentId);
        if (!a) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "report.renew", actor, assessmentId, at: Date.now() })
        );
        await audit({ orgId: a.orgId, actor, action: "report.renew", target: assessmentId, detail: { kind: "assessment" } });
        return resp(200, { ok: true, reportExpiresAt: a.reportExpiresAt });
      }
      if (inviteToken) {
        const inv = await renewCandidateReport(inviteToken);
        if (!inv) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "report.renew", actor, inviteToken, at: Date.now() })
        );
        await audit({ orgId: inv.orgId, actor, action: "report.renew", target: inviteToken, detail: { kind: "candidate" } });
        return resp(200, { ok: true, reportExpiresAt: inv.candidateReportExpiresAt });
      }
      return resp(400, { error: "TARGET_REQUIRED" });
    }

    // -- dispute path (E6): candidate/employer reports a problem on an invite --
    if (method === "POST" && path === "/ent/problems") {
      const { inviteToken } = parsed;
      if (!inviteToken) return resp(400, { error: "INVITE_TOKEN_REQUIRED" });
      const message =
        typeof parsed.message === "string" ? parsed.message.trim().slice(0, 2000) : "";
      if (!message) return resp(400, { error: "MESSAGE_REQUIRED" });
      const actor = cleanActor(parsed.actor, "unknown");
      const res = await appendProblem(inviteToken, { message, actor });
      if (!res) return resp(404, { error: "not found" });
      // Best-effort ops notification -- the problem is already persisted on the
      // invite, so a failed send never fails the report itself. `notify` is false
      // when another problem landed on this invite <15 min ago: the log always
      // grows (capped), but a report-spam loop cannot drain the shared SES quota
      // that also delivers candidate OTPs.
      const emailed = res.notify
        ? await sendOpsEmail(
            "ShieldSync Enterprise: problem reported on an invite",
            `Invite: ${inviteToken}\nActor: ${actor}\nAt: ${res.entry.ts}\n\n${message}`
          )
        : false;
      return resp(200, { ok: true, problem: res.entry, emailed });
    }

    // ── orders/billing ──────────────────────────────────────────────────────
    if (method === "POST" && path === "/ent/orders") {
      const { orgId, invoiceNo, gstin, amountMinor, currency, credits, note } = parsed;
      const actor = cleanActor(parsed.actor);
      const order = await createOrder({ orgId, invoiceNo, gstin, amountMinor, currency, credits, note });
      console.log(JSON.stringify({ audit: true, action: "order.create", actor, orderId: order.orderId, orgId, credits: order.credits, at: Date.now() }));
      await audit({ orgId, actor, action: "order.create", target: order.orderId, detail: { credits: order.credits, invoiceNo: order.invoiceNo } });
      return resp(200, order);
    }

    if (method === "GET" && path === "/ent/orders") {
      const orders = await listOrders(qs.orgId);
      return resp(200, { orders });
    }

    // W3B-1: an org's durable audit trail, newest-first. ShieldSync admin only
    // (the app enforces the staff gate before calling this; the shared-secret
    // gate protects the route itself). Optional ?limit= (clamped 1..200 in
    // entinfra.listAudit).
    if (method === "GET" && path === "/ent/audit") {
      if (!qs.orgId) return resp(400, { error: "ORG_ID_REQUIRED" });
      const auditEvents = await listAudit(qs.orgId, qs.limit);
      return resp(200, { audit: auditEvents });
    }

    if (method === "POST" && path === "/ent/orders/paid") {
      const { orderId } = parsed;
      const actor = cleanActor(parsed.actor);
      // markOrderPaid is a single atomic CAS+grant (E4): only the first call
      // flips created->paid AND adds order.credits to the org; every retry gets
      // { paid:false } and grants nothing.
      const paid = await markOrderPaid(orderId);
      console.log(
        JSON.stringify({ audit: true, action: "order.paid", actor, orderId, paid: paid.paid, creditsGranted: paid.creditsGranted ?? 0, at: Date.now() })
      );
      // markOrderPaid returns only the {paid,creditsGranted} outcome, so read the
      // order once for the orgId to index this audit under (admin action, rare).
      const paidOrder = await getOrder(orderId);
      await audit({ orgId: paidOrder?.orgId, actor, action: "order.paid", target: orderId, detail: { paid: paid.paid, creditsGranted: paid.creditsGranted ?? 0 } });
      return resp(200, { paid });
    }

    // -- agreements (W3-2): MSA/DPA lifecycle. ShieldSync admin drafts/issues/
    // voids; the employer portal accepts. The app enforces its staff gate
    // (admin routes) and org-match (portal accept/view) BEFORE calling these --
    // the engine's shared-secret gate protects the routes themselves. Every
    // status transition happens inside entinfra via a ConditionExpression CAS.
    if (method === "POST" && path === "/ent/agreements") {
      const { orgId, docType } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!orgId || typeof orgId !== "string") return resp(400, { error: "ORG_ID_REQUIRED" });
      if (docType !== "msa" && docType !== "dpa") return resp(400, { error: "DOC_TYPE_INVALID" });
      const bodyText = typeof parsed.bodyText === "string" ? parsed.bodyText : "";
      if (!bodyText.trim()) return resp(400, { error: "BODY_REQUIRED" });
      if (bodyText.length > AGREEMENT_BODY_MAX) {
        return resp(400, { error: "BODY_TOO_LARGE", max: AGREEMENT_BODY_MAX });
      }
      // Draft must belong to a real org -- a typo'd orgId caught here is a clean
      // 404 instead of an orphan row the portal can never surface.
      const org = await getOrg(orgId);
      if (!org) return resp(404, { error: "ORG_NOT_FOUND" });
      const supersedes =
        typeof parsed.supersedes === "string" && parsed.supersedes.trim()
          ? parsed.supersedes.trim().slice(0, 64)
          : undefined;
      const agreement = await createAgreement({
        orgId,
        docType,
        templateVersion:
          typeof parsed.templateVersion === "string" ? parsed.templateVersion.trim().slice(0, 64) : "",
        params: cleanAgreementParams(parsed.params),
        bodyText,
        customized: parsed.customized === true,
        supersedes,
        actor,
      });
      console.log(
        JSON.stringify({ audit: true, action: "agreement.create", actor, agreementId: agreement.agreementId, orgId, docType, customized: agreement.customized, supersedes: supersedes ?? null, at: Date.now() })
      );
      await audit({ orgId, actor, action: "agreement.create", target: agreement.agreementId, detail: { docType, customized: agreement.customized, supersedes: supersedes ?? null } });
      return resp(200, agreement);
    }

    if (method === "POST" && path === "/ent/agreements/update") {
      const { agreementId } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!agreementId) return resp(400, { error: "AGREEMENT_ID_REQUIRED" });
      const patch = {};
      if (parsed.bodyText !== undefined) {
        if (typeof parsed.bodyText !== "string" || !parsed.bodyText.trim()) {
          return resp(400, { error: "BODY_REQUIRED" });
        }
        if (parsed.bodyText.length > AGREEMENT_BODY_MAX) {
          return resp(400, { error: "BODY_TOO_LARGE", max: AGREEMENT_BODY_MAX });
        }
        patch.bodyText = parsed.bodyText;
      }
      if (parsed.params !== undefined) patch.params = cleanAgreementParams(parsed.params);
      if (parsed.templateVersion !== undefined) {
        patch.templateVersion = String(parsed.templateVersion).trim().slice(0, 64);
      }
      if (parsed.customized !== undefined) patch.customized = parsed.customized === true;
      if (Object.keys(patch).length === 0) return resp(400, { error: "NOTHING_TO_UPDATE" });
      try {
        const agreement = await updateAgreementDraft(agreementId, patch);
        if (!agreement) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "agreement.update", actor, agreementId, fields: Object.keys(patch), at: Date.now() })
        );
        await audit({ orgId: agreement.orgId, actor, action: "agreement.update", target: agreementId, detail: { fields: Object.keys(patch) } });
        return resp(200, agreement);
      } catch (e) {
        // Draft-only edits: an issued/accepted/void agreement is immutable.
        if (e.code === "NOT_DRAFT") return resp(409, { error: "NOT_DRAFT", status: e.status });
        throw e;
      }
    }

    if (method === "POST" && path === "/ent/agreements/issue") {
      const { agreementId } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!agreementId) return resp(400, { error: "AGREEMENT_ID_REQUIRED" });
      try {
        const agreement = await issueAgreement(agreementId, actor);
        if (!agreement) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "agreement.issue", actor, agreementId, orgId: agreement.orgId, docType: agreement.docType, sha256: agreement.sha256, at: Date.now() })
        );
        await audit({ orgId: agreement.orgId, actor, action: "agreement.issue", target: agreementId, detail: { docType: agreement.docType, sha256: agreement.sha256 } });
        // Supersede cascade (W3-1): this new agreement replaces an older one.
        // BEST-EFFORT second update by contract -- the issue above already
        // committed, and a cascade failure is logged for ops, never surfaced as
        // an issue failure (the old row can be re-marked manually).
        if (agreement.supersedes) {
          try {
            const marked = await markAgreementSuperseded(agreement.supersedes, agreement.agreementId);
            if (marked) {
              console.log(
                JSON.stringify({ audit: true, action: "agreement.superseded", actor, agreementId: agreement.supersedes, supersededBy: agreement.agreementId, at: Date.now() })
              );
            } else {
              console.error("[ent/agreements/issue] supersede target not markable (missing or wrong state):", agreement.supersedes);
            }
          } catch (e) {
            console.error("[ent/agreements/issue] supersede mark failed (non-fatal):", e.message);
          }
        }
        return resp(200, agreement);
      } catch (e) {
        if (e.code === "NOT_ISSUABLE") return resp(409, { error: "NOT_ISSUABLE", status: e.status });
        throw e;
      }
    }

    if (method === "POST" && path === "/ent/agreements/accept") {
      const { agreementId } = parsed;
      // acceptedBy = the portal user's email (the app injects it from the
      // session server-side). Sanitized + clamped to 254 chars.
      const acceptedBy = cleanEmail(parsed.acceptedBy);
      const actor = cleanActor(parsed.actor, acceptedBy || "portal");
      if (!agreementId) return resp(400, { error: "AGREEMENT_ID_REQUIRED" });
      if (!acceptedBy) return resp(400, { error: "ACCEPTED_BY_REQUIRED" });
      try {
        const r = await acceptAgreement(agreementId, acceptedBy);
        if (!r) return resp(404, { error: "not found" });
        const agreement = r.agreement;
        if (!r.already) {
          // Mirror the accepted version onto the org row (W3-2). Best-effort +
          // non-fatal by contract: the agreement row is the source of truth,
          // and the accept must never fail because the mirror write did.
          try {
            await setOrgAcceptedAgreement(agreement.orgId, agreement.templateVersion);
          } catch (e) {
            console.error("[ent/agreements/accept] org mirror failed (non-fatal):", e.message);
          }
          console.log(
            JSON.stringify({ audit: true, action: "agreement.accept", actor, agreementId, orgId: agreement.orgId, docType: agreement.docType, acceptedBy, sha256: agreement.sha256, at: Date.now() })
          );
          await audit({ orgId: agreement.orgId, actor, action: "agreement.accept", target: agreementId, detail: { docType: agreement.docType, acceptedBy, sha256: agreement.sha256 } });
        }
        return resp(200, { ok: true, already: r.already, agreement });
      } catch (e) {
        if (e.code === "NOT_ACCEPTABLE") return resp(409, { error: "NOT_ACCEPTABLE", status: e.status });
        throw e;
      }
    }

    if (method === "POST" && path === "/ent/agreements/void") {
      const { agreementId } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!agreementId) return resp(400, { error: "AGREEMENT_ID_REQUIRED" });
      try {
        const agreement = await voidAgreement(agreementId, actor);
        if (!agreement) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "agreement.void", actor, agreementId, orgId: agreement.orgId, at: Date.now() })
        );
        await audit({ orgId: agreement.orgId, actor, action: "agreement.void", target: agreementId, detail: { docType: agreement.docType } });
        return resp(200, { ok: true, agreement });
      } catch (e) {
        if (e.code === "NOT_VOIDABLE") return resp(409, { error: "NOT_VOIDABLE", status: e.status });
        throw e;
      }
    }

    // List stays LIGHT: no bodyText (up to 200KB/row) -- the full text comes
    // from GET /ent/agreement one row at a time.
    if (method === "GET" && path === "/ent/agreements") {
      if (!qs.orgId) return resp(400, { error: "ORG_ID_REQUIRED" });
      const agreements = await listAgreements(qs.orgId);
      return resp(200, { agreements });
    }

    // Full row incl. bodyText + sha256. Portal callers MUST verify the
    // agreement's orgId matches the session org app-side (W3-2 contract).
    if (method === "GET" && path === "/ent/agreement") {
      if (!qs.agreementId) return resp(400, { error: "AGREEMENT_ID_REQUIRED" });
      const agreement = await getAgreement(qs.agreementId);
      if (!agreement) return resp(404, { error: "not found" });
      return resp(200, agreement);
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
      // DISPATCH ASYNC — the warm is a ~90s CloudFormation deploy; awaiting it
      // inline blew the API Gateway 30s integration timeout (book 503'd while
      // the warm ran on + occupied the account). Warming is an optimization,
      // not correctness, so a dispatch failure never fails the booking.
      try {
        const assessment = await getAssessment(invite.assessmentId);
        if (assessment?.labSlug) await invokeEntWorker("warm-ent", { labSlug: assessment.labSlug });
      } catch (e) {
        console.error("[ent/book] pre-warm dispatch failed (non-fatal):", e.message);
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
      // E8: the candidate app's timer/pagehide auto-submit sends auto:true so the
      // stored result records that the attempt was closed out automatically.
      const autoSubmitted = parsed.auto === true;
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
          autoSubmitted,
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
