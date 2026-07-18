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
  claimStartLease,
  releaseStartClaim,
  consentInvite,
  refundInvite,
  revokeInvite,
  stampInviteResend,
  stampAzureSession,
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
  createLead,
  listLeads,
  updateLeadStatus,
  LEAD_STATUSES,
  createDoc,
  getDoc,
  listDocs,
  setDocOtp,
  acceptDoc,
  revokeDoc,
  stampDocResend,
  sha256HexBytes,
  platformCredentials,
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
// Transactional email no longer uses SES (prod-access request was denied for
// this account). Sends go out via the Resend HTTP API through a drop-in
// ses.send() shim + local SendEmailCommand class defined below (~line 137), so
// the six existing SendEmailCommand call sites stay byte-for-byte unchanged.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream, readFileSync, existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomInt } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Azure lab lifecycle driver (Portal v2 multi-cloud). SAFE to import statically:
// azure-infra.mjs's only top-level import is node:crypto -- every @azure/* package
// is a LAZY dynamic import inside a verb. So loading this module never pulls the
// @azure deps, and the whole Azure path stays dormant (zero effect on the live AWS
// flow) unless an "azure"-track lab is actually leased.
import {
  lease as azLease,
  deploy as azDeploy,
  seedBlob as azSeedBlob,
  grade as azGrade,
  teardown as azTeardown,
} from "./azure-infra.mjs";

// Absolute dir of this module -- used to locate the bundled labs/ tree for track
// detection (see entLabTrack). In Lambda that's /var/task; locally it's engine/.
const _here = dirname(fileURLToPath(import.meta.url));

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

// Azure has no scarce account pool (its disposable unit is a per-session Resource
// Group minted fresh at /ent/start), so its "capacity" isn't a warm-pool count.
// This is the per-slot concurrency ceiling the booking flow gates Azure labs on --
// a soft guard well under the subscription's storage-account/RG limits, not a pool.
const AZURE_SLOT_CAP = 20;

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
// --- Email transport: Resend HTTP API (drop-in for the two @aws-sdk/client-ses
// symbols this file used) -----------------------------------------------------
// SES prod access was denied for this account, so email now goes via Resend.
// SendEmailCommand just captures its params; ses.send() translates the SES
// SendEmail shape to a single Resend POST. It THROWS on any failure (missing
// key, non-2xx from Resend) so every caller's existing try/catch keeps its
// best-effort contract -- a send failure is logged and swallowed, never failing
// the parent op. RESEND_API_KEY is a Lambda secret (never in source); the
// from-address stays ENT_OTP_FROM, which MUST be an address on a
// Resend-verified domain (e.g. "ShieldSync <no-reply@shieldsyncsecurity.com>").
// Uses the native global fetch (Lambda nodejs22.x) -- no email SDK dependency.
class SendEmailCommand {
  constructor(input) {
    this.input = input;
  }
}
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const ses = {
  async send(command) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not set");
    const m = command.input ?? {};
    const body = {
      from: m.Source,
      to: m.Destination?.ToAddresses ?? [],
      subject: m.Message?.Subject?.Data ?? "",
    };
    const text = m.Message?.Body?.Text?.Data;
    const html = m.Message?.Body?.Html?.Data;
    if (text != null) body.text = text;
    if (html != null) body.html = html;
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 429 = Resend rate limit (~per-second) OR the free-plan daily cap
      // (100/day). Log a DISTINCT, stable marker before throwing so a CloudWatch
      // metric-filter alarm can catch quota-blocked delivery -- otherwise a
      // candidate's OTP/invite (on the critical path) is silently dropped as a
      // generic send failure. Still throws: callers log + swallow (never block).
      if (res.status === 429) {
        console.error(
          `[ent][EMAIL_QUOTA] Resend 429 rate/quota limit -- email dropped; retry-after=${res.headers.get("retry-after") ?? "?"}`
        );
      }
      throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  },
};

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

// -- Documents (doc-signing portal) -------------------------------------------
//
// PDF bytes live in a dedicated PRIVATE S3 bucket in the platform account
// (created by engine/create-ent-docs-infra.mjs: versioning ON, BPA on, SSE-S3).
// Transport is base64 inside the JSON body BOTH ways -- a deliberate trade: no
// presigned URLs to leak, no extra SDK packages, and the Lambda 6MB sync payload
// ceiling caps the PDF at 4MB (4MB * 4/3 base64 = ~5.4MB), which is plenty for
// business proposals/SOWs. The 4MB limit is enforced here AND surfaced in the
// admin upload UI.
const DOCS_BUCKET = "shieldsync-ent-docs-750294427884";
const MAX_DOC_PDF_BYTES = 4 * 1024 * 1024;
const DOC_EXPIRES_DAYS_DEFAULT = 30;
const DOC_EXPIRES_DAYS_MAX = 180;
const DOC_RESEND_COOLDOWN_SEC = 45;
// All doc-portal audit rows share one synthetic partition in ShieldSyncEntAudit
// (documents belong to ShieldSync itself, not to an employer org).
const DOCS_AUDIT_ORG = "shieldsync:docs";

// Docs S3 client: in Lambda the execution role is the identity; locally, bridge
// through the same STS role entinfra's DynamoDB client uses so dev/tests can
// reach the platform-account bucket.
let _docsS3;
function docsS3() {
  if (_docsS3) return _docsS3;
  _docsS3 = process.env.AWS_LAMBDA_FUNCTION_NAME
    ? new S3Client({ region: "us-east-1" })
    : new S3Client({ region: "us-east-1", credentials: platformCredentials });
  return _docsS3;
}

// maskEmail(): display-safe form of the signer email for the PUBLIC signing
// page ("k***@gmail.com") -- the full address never leaves the engine on a
// public route; the OTP is only ever SENT to the registered address.
function maskEmail(email) {
  const s = String(email ?? "");
  const at = s.indexOf("@");
  if (at < 1) return "***";
  return s[0] + "***@" + s.slice(at + 1);
}

// sanitizeDocPublic(): the ONLY doc shape public routes may return. Never
// includes docToken (the caller already holds it), raw signerEmail, otp*
// fields, s3Key, or internal note.
function sanitizeDocPublic(doc) {
  return {
    status: doc.status,
    title: doc.title,
    fileName: doc.fileName,
    sizeBytes: doc.sizeBytes,
    sha256: doc.sha256,
    signerName: doc.signerName,
    signerEmailMasked: maskEmail(doc.signerEmail),
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    otpLocked: doc.otpLocked,
    // Acceptance record fields -- only present once signed.
    acceptedAt: doc.acceptedAt,
    acceptedName: doc.acceptedName,
    acceptedEmail: doc.status === "signed" ? doc.acceptedEmail : undefined,
    acceptIp: doc.status === "signed" ? doc.acceptIp : undefined,
    acceptUa: doc.status === "signed" ? doc.acceptUa : undefined,
    docHash: doc.docHash,
  };
}

// sendDocSignLinkEmail(): email the signer their personal signing link. Same
// anti-phishing contract as sendInviteLinkEmail: the link host is ALWAYS our
// own pinned origin, and the recipient is ALWAYS the REGISTERED signerEmail --
// caller input never controls either. Best-effort; returns whether it sent.
async function sendDocSignLinkEmail({ signerEmail, signerName, title, docToken }) {
  const from = process.env.ENT_OTP_FROM;
  if (!from || !signerEmail) return false;
  const appOrigin = (process.env.ENT_APP_URL || "https://enterprise.shieldsyncsecurity.com").replace(/\/+$/, "");
  const link = `${appOrigin}/sign/${docToken}`;
  const rawWho = typeof signerName === "string" && signerName.trim() ? signerName.trim() : "there";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const who = esc(rawWho);
  const safeTitle = esc(title ?? "Document");
  try {
    await ses.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [signerEmail] },
        Message: {
          Subject: { Data: `Document for your review and acceptance: ${String(title ?? "Document").slice(0, 120)}` },
          Body: {
            Text: {
              Data: `Hi ${rawWho},\n\nShieldSync has shared a document with you for review and electronic acceptance:\n\n  ${title}\n\nReview and accept it here:\n${link}\n\nHow it works: open the link, read the document, then confirm a one-time code sent to this email address and type your full name to accept. You'll receive a copy of the executed document and its acceptance record by email.\n\nThis link is personal to you -- please don't share it. If you weren't expecting this, you can safely ignore this email.\n\nRegards,\nShieldSync\nshieldsyncsecurity.com`,
            },
            Html: {
              Data: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:8px"><div style="font-size:15px;font-weight:800;letter-spacing:-0.01em;color:#0a1020;padding:4px 0 18px">Shield<span style="color:#d97706">Sync</span></div><p style="font-size:15px;line-height:1.55;margin:0 0 14px">Hi ${who},</p><p style="font-size:15px;line-height:1.55;margin:0 0 16px">ShieldSync has shared a document with you for review and <strong>electronic acceptance</strong>:</p><p style="font-size:15px;font-weight:700;margin:0 0 20px">${safeTitle}</p><a href="${link}" style="display:inline-block;background:#d97706;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Review &amp; accept</a><p style="font-size:12px;line-height:1.5;color:#64748b;margin:18px 0 0">Or paste this link into your browser:<br/><span style="color:#475569">${link}</span></p><p style="font-size:12px;line-height:1.5;color:#64748b;margin:14px 0 0">How it works: open the link, read the document, then confirm a one-time code sent to this email address and type your full name to accept. You'll receive a copy of the executed document and its acceptance record by email.</p><p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:14px 0 0">This link is personal to you -- please don't share it. If you weren't expecting this, you can safely ignore this email.</p></div>`,
            },
          },
        },
      })
    );
    return true;
  } catch (e) {
    console.error("[ent/docs] sign-link email send failed:", e.name, e.message);
    return false;
  }
}

// sendDocAcceptedEmails(): acknowledgment to BOTH parties after an accept
// commits -- the signer gets their copy/record link, ops gets the executed
// notice. Both best-effort and independent: one failing never blocks the other,
// and neither can fail the accept itself (the record is already durable).
// WORDING RULE: "electronically accepted" -- never "digitally signed" (this is
// click-accept evidence, not an IT Act section 3 signature).
async function sendDocAcceptedEmails(doc, docToken) {
  const from = process.env.ENT_OTP_FROM;
  const appOrigin = (process.env.ENT_APP_URL || "https://enterprise.shieldsyncsecurity.com").replace(/\/+$/, "");
  const certLink = `${appOrigin}/sign/${docToken}/certificate`;
  const summary =
    `Document: ${doc.title}\n` +
    `File: ${doc.fileName}\n` +
    `SHA-256: ${doc.docHash}\n` +
    `Electronically accepted by: ${doc.acceptedName} (${doc.acceptedEmail}, verified by one-time code)\n` +
    `Accepted at: ${doc.acceptedAt} (UTC)\n` +
    `IP address: ${doc.acceptIp}`;
  let signerEmailed = false;
  if (from && doc.acceptedEmail) {
    try {
      await ses.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [doc.acceptedEmail] },
          Message: {
            Subject: { Data: `Accepted: ${String(doc.title ?? "Document").slice(0, 120)}` },
            Body: {
              Text: {
                Data: `Hi ${doc.acceptedName || "there"},\n\nThis confirms you electronically accepted the following document:\n\n${summary}\n\nYour copy of the document and the acceptance certificate stay available here:\n${certLink}\n\nPlease keep this email for your records.\n\nRegards,\nShieldSync\nshieldsyncsecurity.com`,
              },
            },
          },
        })
      );
      signerEmailed = true;
    } catch (e) {
      console.error("[ent/docs] signer ack email failed:", e.name, e.message);
    }
  }
  const opsEmailed = await sendOpsEmail(
    `ShieldSync: document electronically accepted -- ${String(doc.title ?? "").slice(0, 100)}`,
    `${summary}\nUser agent: ${doc.acceptUa}\n\nCertificate: ${certLink}\nAdmin list: ${appOrigin}/admin/documents`
  );
  return { signerEmailed, opsEmailed };
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

// ── Multi-cloud track dispatch (Portal v2) ────────────────────────────────────
// A lab's cloud provider lives in its lab.json `track` ("aws" | "azure"). The
// enterprise engine forks the account-lifecycle verbs (slots/book/start/submit +
// the deploy/grade/teardown workers) by track: the DEFAULT AWS path is unchanged;
// an "azure" lab routes to azure-infra.mjs + graders.azure.mjs, whose disposable
// unit is a per-session RESOURCE GROUP (no account pool, no warm) instead of a
// leased AWS account. Read from the bundled labs/ tree once, then cached. ANY
// problem -- unsafe slug, missing lab.json, unreadable JSON -- falls back to "aws",
// so a packaging slip can NEVER silently route an AWS lab down the Azure path
// (which would try to create Azure resources for an AWS scenario, or vice versa).
const _trackCache = new Map();
const SAFE_LAB_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
function entLabTrack(labSlug) {
  if (typeof labSlug !== "string" || !SAFE_LAB_SLUG.test(labSlug)) return "aws";
  if (_trackCache.has(labSlug)) return _trackCache.get(labSlug);
  let track = "aws";
  try {
    // Lambda unzips labs/ next to this module (here/labs); a local run has them at
    // the repo root (here/../labs). Try both, mirroring azure-infra's loader.
    const candidates = [
      join(_here, "labs", labSlug, "lab.json"),
      join(_here, "..", "labs", labSlug, "lab.json"),
    ];
    const p = candidates.find((f) => existsSync(f));
    if (p) {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (typeof j.track === "string" && j.track.trim()) track = j.track.trim().toLowerCase();
    }
  } catch {
    track = "aws";
  }
  _trackCache.set(labSlug, track);
  return track;
}

// azurePortalUrl(): the learner-facing URL for an Azure session. Unlike AWS (a
// federated console SIGN-IN URL minted per session by mintConsoleUrl), the Azure
// candidate-access mechanism -- a per-session Entra principal for mintAccess, or
// CLI-first service-principal credentials -- is an OWNER-GATED decision (see the
// project_shieldsync_azure_labs memory: CLI-first vs Portal-parity) and is NOT
// wired here. Until it is, /ent/start returns the RG's portal overview URL as a
// placeholder plus accessPending:true, so the app renders a "provisioning / access
// pending" state rather than a broken console link. Returns null if ids are absent.
function azurePortalUrl(sess) {
  const sub = sess.azSubscriptionId || sess.subscriptionId;
  const rg = sess.azResourceGroup || sess.resourceGroup;
  if (!sub || !rg) return null;
  return `https://portal.azure.com/#@/resource/subscriptions/${sub}/resourceGroups/${rg}/overview`;
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

// ── Azure worker actions (deploy+seed / teardown) ─────────────────────────────
// The Azure analog of runDeployEnt / runTeardownEnt. Azure's deploy (ARM template
// or Deployment Stack) + blob seed is ~1-2 min, so it MUST run async — awaiting it
// inline in /ent/start would blow the API Gateway 30s ceiling, exactly like the AWS
// cold deploy. Unlike AWS (where the account + exec role are known at lease time),
// the Azure storage account name is only known AFTER deploy, so this worker STAMPS
// it (plus the anon blob URL + stack name + ready flag) back onto the invite via
// stampAzureSession so /ent/submit can grade + tear down. stampAzureSession never
// touches status, so it can't clobber a candidate who submitted meanwhile.
async function runDeployAzure({ inviteToken, sessionId, resourceGroup, subscriptionId, location, labSlug }) {
  try {
    const deployed = await azDeploy({ sessionId, resourceGroup, subscriptionId, location, labSlug });
    const seeded = await azSeedBlob(deployed);
    await stampAzureSession(inviteToken, {
      azStorageAccount: seeded.storageAccountName,
      azBlobContainer: seeded.blobContainer,
      azAnonBlobUrl: seeded.anonymousBlobUrl,
      azStackName: seeded.stackName,
      azReady: true,
    }).catch((e) => console.error(`[ent-worker/azure] stamp failed ${inviteToken}: ${e.message}`));
  } catch (e) {
    console.error(`[ent-worker/azure] deploy failed ${sessionId}: ${e.message}`);
    // Provision failed — mark the invite so the app can surface an error, and
    // best-effort tear down anything half-created so the RG never leaks/bills.
    await stampAzureSession(inviteToken, { azError: "provision_failed" }).catch(() => {});
    await azTeardown({ resourceGroup, subscriptionId }).catch(() => {});
  }
  return { ok: true };
}

async function runTeardownAzure({ resourceGroup, subscriptionId, stackName, roleDefId }) {
  try {
    if (resourceGroup) await azTeardown({ resourceGroup, subscriptionId, stackName, roleDefId });
  } catch (e) {
    // Never throw out of the worker — teardown failures are logged and left for
    // ops to reconcile (the RG-delete is the authoritative wipe; a failure here
    // is rare and surfaced in CloudWatch, not to the already-submitted candidate).
    console.error(`[ent-worker/azure] teardown failed ${resourceGroup}: ${e.message}`);
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
  if (action === "deploy-azure") return runDeployAzure(payload);
  if (action === "teardown-azure") return runTeardownAzure(payload);
}

// ── Azure branch of POST /ent/start ───────────────────────────────────────────
// Mirrors the AWS start's concurrency discipline (claimStartLease serializes the
// fresh provision ON THE INVITE so two concurrent starts can't mint two RGs and
// orphan one) but with Azure's lifecycle: mint an RG (azLease), then dispatch the
// async deploy+seed worker. Azure has no warm pool, so a fresh start is ALWAYS
// "leasing" until the worker stamps azReady. Reconnect = the invite already holds a
// live RG (started, not yet torn down), so re-attach without minting a second RG.
// The caller has already validated the invite exists, is unexpired, and is in a
// startable state (booked|started).
async function startAzureSession({ invite, inviteToken, labSlug }) {
  // Reconnect: a started invite that still carries its RG re-attaches (never a 2nd RG).
  if (invite.status === "started" && invite.azResourceGroup) {
    return resp(200, {
      sessionId: invite.sessionId,
      status: invite.azReady ? "active" : "leasing",
      consoleUrl: azurePortalUrl(invite),
      scoredExpiresAt: invite.scoredExpiresAt,
      expiresAt: invite.scoredExpiresAt,
      reconnected: true,
      accessPending: true,
    });
  }

  // Serialize the fresh provision on the invite (same claim primitive as AWS).
  const claimed = await claimStartLease(inviteToken);
  if (!claimed) {
    // Another concurrent start is already provisioning this invite. Re-read: if it
    // now holds an RG, reconnect the candidate to it; else ask the app to retry.
    const fresh = await getInvite(inviteToken);
    if (fresh?.azResourceGroup) {
      return resp(200, {
        sessionId: fresh.sessionId,
        status: fresh.azReady ? "active" : "leasing",
        consoleUrl: azurePortalUrl(fresh),
        scoredExpiresAt: fresh.scoredExpiresAt,
        expiresAt: fresh.scoredExpiresAt,
        reconnected: true,
        accessPending: true,
      });
    }
    return resp(409, { error: "START_IN_PROGRESS", retry: true });
  }

  let leased;
  try {
    leased = await azLease("ent:" + inviteToken, labSlug);
  } catch (e) {
    // Nothing provisioned -> free the claim so the candidate's next poll retries
    // immediately instead of eating 409s for the claim TTL.
    await releaseStartClaim(inviteToken);
    console.error("[ent/start/azure] lease failed:", e?.message);
    return resp(503, { error: "NO_CAPACITY", retry: true });
  }

  const scoredExpiresAt = new Date(Date.now() + ENT_TIMEBOX_MIN * 60000).toISOString();
  // Persist the Azure session handles onto the invite so /ent/submit can grade +
  // tear down. azReady=false until the async worker finishes deploy+seed.
  await setInviteStatus(inviteToken, "started", {
    sessionId: leased.sessionId,
    azResourceGroup: leased.resourceGroup,
    azSubscriptionId: leased.subscriptionId,
    azLocation: leased.location,
    azReady: false,
    consumedCompute: true,
    startedAt: new Date().toISOString(),
    scoredExpiresAt,
  });

  // Async deploy+seed (~1-2 min): stamps azStorageAccount/azAnonBlobUrl/azStackName
  // + azReady back onto the invite when done.
  await invokeEntWorker("deploy-azure", {
    inviteToken,
    sessionId: leased.sessionId,
    resourceGroup: leased.resourceGroup,
    subscriptionId: leased.subscriptionId,
    location: leased.location,
    labSlug,
  });

  return resp(200, {
    sessionId: leased.sessionId,
    status: "leasing",
    warm: false,
    consoleUrl: azurePortalUrl(leased),
    scoredExpiresAt,
    expiresAt: scoredExpiresAt,
    accessPending: true,
  });
}

// ── Azure branch of POST /ent/submit ──────────────────────────────────────────
// Same grade-then-teardown discipline as the AWS submit (grade WHILE the
// environment is still live; ALWAYS tear the RG down in finally so it can't
// leak/bill), but grades via graders.azure.mjs against the account's control-plane
// flags + an unauthenticated data-plane probe, and tears down by deleting the RG.
// The Azure session state lives on the invite (stamped by the deploy-azure worker),
// not in a session table. The caller has already handled the idempotent
// double-submit + NOT_SUBMITTABLE (status !== "started") guards.
async function submitAzureSession({ invite, inviteToken, labSlug, reflection, autoSubmitted }) {
  if (!labSlug || !invite.azResourceGroup) {
    return resp(409, { error: "NO_ACTIVE_SESSION" });
  }

  const nowMs = Date.now();
  const scoredExpMs = invite.scoredExpiresAt ? new Date(invite.scoredExpiresAt).getTime() : NaN;
  const lateSubmit = Number.isFinite(scoredExpMs) && nowMs > scoredExpMs;
  const secondsLate = lateSubmit ? Math.round((nowMs - scoredExpMs) / 1000) : 0;
  const reflectionText =
    typeof reflection === "string" ? reflection.slice(0, REFLECTION_MAX_CHARS) : null;

  try {
    let grade;
    let gradeError;
    try {
      if (!invite.azStorageAccount) {
        // The async deploy hasn't finished (or failed) -> nothing gradeable. Record
        // incomplete rather than throwing; the finally still tears the RG down.
        gradeError = "grading_incomplete";
        grade = { gradable: false, criteria: [], passed: false };
      } else {
        grade = await azGrade({
          labSlug,
          subscriptionId: invite.azSubscriptionId,
          resourceGroup: invite.azResourceGroup,
          storageAccountName: invite.azStorageAccount,
          anonymousBlobUrl: invite.azAnonBlobUrl,
        });
      }
    } catch (e) {
      // Full detail (may embed subscription id / RG) to CloudWatch ONLY; a fixed
      // string into the stored result the employer sees.
      console.error("[ent/submit/azure] grade failed:", e);
      gradeError = "grading_incomplete";
      grade = { gradable: false, criteria: [], passed: false };
    }

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
    return resp(200, { ok: true, submitted: true, lateSubmit });
  } finally {
    // ALWAYS delete the RG, even if grading/putResult threw, so nothing leaks.
    await invokeEntWorker("teardown-azure", {
      resourceGroup: invite.azResourceGroup,
      subscriptionId: invite.azSubscriptionId,
      stackName: invite.azStackName,
      roleDefId: invite.azRoleDefId,
    }).catch((e) => console.error("[ent/submit/azure] teardown dispatch failed:", e?.message));
  }
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
    if (action === "deploy-azure") {
      await runDeployAzure(event);
      return { ok: true };
    }
    if (action === "teardown-azure") {
      await runTeardownAzure(event);
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

    // -- leads (Book a walkthrough / pricing form on the PUBLIC landing) -------
    // Pre-auth surface: anyone on the internet reaches this via the app's
    // /api/leads route, so every field is clamped, email shape is checked, and
    // entinfra's per-email cooldown row bounds repeat submissions. The lead is
    // persisted FIRST; the ops email is best-effort on top (sendOpsEmail never
    // throws), so a SES hiccup can't lose a prospect.
    if (method === "POST" && path === "/ent/leads") {
      const email = typeof parsed.email === "string" ? parsed.email.trim().slice(0, 254) : "";
      if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return resp(400, { error: "EMAIL_INVALID" });
      }
      const name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 120) : "";
      if (!name) return resp(400, { error: "NAME_REQUIRED" });
      const company = typeof parsed.company === "string" ? parsed.company.trim().slice(0, 160) : "";
      const topic = ["walkthrough", "pricing", "other"].includes(parsed.topic) ? parsed.topic : "other";
      const message = typeof parsed.message === "string" ? parsed.message.trim().slice(0, 2000) : "";
      const source = typeof parsed.source === "string" ? parsed.source.trim().slice(0, 200) : "";

      const res = await createLead({ name, email, company, topic, message, source });
      if (res.cooldown) return resp(429, { error: "LEAD_COOLDOWN" });

      console.log(
        JSON.stringify({ audit: true, action: "lead.create", leadId: res.lead.leadId, topic, at: Date.now() })
      );
      const emailed = await sendOpsEmail(
        `ShieldSync Enterprise: new ${topic} lead — ${company || name}`,
        `Name: ${name}\nEmail: ${email}\nCompany: ${company || "-"}\nTopic: ${topic}\nSource: ${source || "-"}\n\n${message || "(no message)"}\n\nReview: https://enterprise.shieldsyncsecurity.com/admin/leads`
      );
      return resp(200, { ok: true, leadId: res.lead.leadId, emailed });
    }

    // ShieldSync admin only (the app enforces the staff gate before calling).
    if (method === "GET" && path === "/ent/leads") {
      const leads = await listLeads();
      return resp(200, { leads });
    }

    if (method === "POST" && path === "/ent/leads/update") {
      const { leadId, status } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!leadId) return resp(400, { error: "LEAD_ID_REQUIRED" });
      if (!LEAD_STATUSES.includes(status)) return resp(400, { error: "STATUS_INVALID" });
      const lead = await updateLeadStatus(leadId, status);
      if (!lead) return resp(404, { error: "not found" });
      console.log(
        JSON.stringify({ audit: true, action: "lead.status", actor, leadId, status, at: Date.now() })
      );
      return resp(200, { ok: true, lead });
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

    // ── documents (doc-signing portal: e-accept SOWs/proposals/agreements) ──
    //
    // ONE universal flow for any PDF + named signer -- zero per-company
    // customization by design. Register (staff) -> /sign/<token> (public view +
    // email OTP + typed-name accept) -> immutable acceptance record + emails to
    // both parties. Lifecycle status codes mirror the invite flow: 404 unknown
    // OR revoked (oracle-free, the report-link precedent), 410 expired link,
    // 409 wrong state.

    // Staff registers a document. The app enforces its admin gate BEFORE calling
    // this and mints docToken once (idempotent retry contract, like invites).
    if (method === "POST" && path === "/ent/docs") {
      const actor = cleanActor(parsed.actor);
      const docToken = parsed.docToken;
      if (!docToken || typeof docToken !== "string" || !/^[0-9a-f]{32,64}$/.test(docToken)) {
        return resp(400, { error: "DOC_TOKEN_REQUIRED" });
      }
      const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 200) : "";
      if (!title) return resp(400, { error: "TITLE_REQUIRED" });
      const signerEmail = typeof parsed.signerEmail === "string" ? parsed.signerEmail.trim().slice(0, 254) : "";
      if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(signerEmail)) {
        return resp(400, { error: "SIGNER_EMAIL_INVALID" });
      }
      const signerName = typeof parsed.signerName === "string" ? parsed.signerName.trim().slice(0, 120) : "";
      const note = typeof parsed.note === "string" ? parsed.note.trim().slice(0, 500) : "";
      // fileName: display-only -- strip any path, clamp, force a .pdf suffix.
      let fileName = typeof parsed.fileName === "string" ? parsed.fileName.trim() : "";
      fileName = fileName.split(/[\\/]/).pop().replace(/[^\w. ()-]/g, "").slice(0, 140) || "document.pdf";
      if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";
      const expiresDays = Math.min(
        DOC_EXPIRES_DAYS_MAX,
        Math.max(1, Number.isFinite(Number(parsed.expiresDays)) ? Math.round(Number(parsed.expiresDays)) : DOC_EXPIRES_DAYS_DEFAULT)
      );
      const expiresAt = new Date(Date.now() + expiresDays * 24 * 3600 * 1000).toISOString();

      if (typeof parsed.pdfBase64 !== "string" || !parsed.pdfBase64) {
        return resp(400, { error: "PDF_REQUIRED" });
      }
      let pdfBytes;
      try {
        pdfBytes = Buffer.from(parsed.pdfBase64, "base64");
      } catch {
        return resp(400, { error: "PDF_INVALID" });
      }
      if (pdfBytes.length === 0) return resp(400, { error: "PDF_INVALID" });
      if (pdfBytes.length > MAX_DOC_PDF_BYTES) {
        return resp(400, { error: "PDF_TOO_LARGE", maxBytes: MAX_DOC_PDF_BYTES });
      }
      // Magic check: must actually BE a PDF (the viewer serves these bytes back
      // with content-type application/pdf; never store something else there).
      if (pdfBytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return resp(400, { error: "PDF_INVALID" });
      }

      const sha256 = sha256HexBytes(pdfBytes);
      const s3Key = `docs/${docToken}.pdf`;
      // Existing row? Resolve WITHOUT touching S3 -- a reuse attempt with new
      // content must never overwrite the object a LIVE signing link serves
      // (caught by the harness: the old order S3-put-then-row-put clobbered the
      // stored bytes before the 409). Same-content retry stays a benign no-op.
      const existing = await getDoc(docToken);
      if (existing) {
        if (existing.sha256 === sha256) {
          const clean = { ...existing };
          delete clean.otpHash;
          return resp(200, { ...clean, already: true, emailed: false });
        }
        return resp(409, { error: "DOC_TOKEN_REUSED" });
      }
      // S3 put BEFORE the row: a row must never point at a missing object. An
      // orphan object from a failed row write is harmless -- the retry
      // overwrites the same key with identical bytes (and versioning keeps
      // history). The truly-concurrent same-token-different-content race stays
      // theoretical (tokens are app-minted CSPRNG per upload) and is backstopped
      // by the serve-time hash check in GET /ent/doc/pdf, which fails CLOSED.
      await docsS3().send(
        new PutObjectCommand({
          Bucket: DOCS_BUCKET,
          Key: s3Key,
          Body: pdfBytes,
          ContentType: "application/pdf",
        })
      );

      const created = await createDoc({
        docToken, title, fileName, signerName, signerEmail, note, s3Key,
        sizeBytes: pdfBytes.length, sha256, expiresAt, actor,
      });
      if (created.already) {
        // Benign only when the SAME content was re-registered under the same
        // app-minted token (a retried POST). A different hash means the caller
        // reused a token for new content -- refuse, that would silently rebind
        // a live signing link to a different document.
        if (created.doc?.sha256 === sha256) {
          const clean = { ...created.doc };
          delete clean.otpHash;
          return resp(200, { ...clean, already: true, emailed: false });
        }
        return resp(409, { error: "DOC_TOKEN_REUSED" });
      }

      console.log(
        JSON.stringify({ audit: true, action: "doc.register", actor, doc: docToken.slice(0, 8), sha256, at: Date.now() })
      );
      await audit({ orgId: DOCS_AUDIT_ORG, actor, action: "doc.register", target: docToken.slice(0, 8), detail: { title, fileName, sha256, signerEmail } });

      // Optionally email the signer their link (best-effort, first create only).
      let emailed = false;
      if (parsed.sendLink) {
        emailed = await sendDocSignLinkEmail({ signerEmail, signerName, title, docToken });
      }
      return resp(200, { ...created.doc, already: false, emailed });
    }

    // Staff list -- rows include docToken for app-server-side actions; the app
    // renders 8-char display ids ONLY (never raw tokens in lists).
    if (method === "GET" && path === "/ent/docs") {
      const docs = await listDocs();
      return resp(200, { docs });
    }

    // Public signing-page fetch (the app proxies /sign/<token> through this).
    // Revoked is indistinguishable from never-existed; an expired PENDING link
    // is a 410; a signed doc stays viewable forever (it's the signer's copy).
    if (method === "GET" && path === "/ent/doc") {
      const doc = await getDoc(qs.docToken);
      if (!doc || doc.status === "revoked") return resp(404, { error: "not found" });
      if (doc.status === "pending" && doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      return resp(200, sanitizeDocPublic(doc));
    }

    // Public PDF bytes (base64) -- same lifecycle gates as GET /ent/doc.
    if (method === "GET" && path === "/ent/doc/pdf") {
      const doc = await getDoc(qs.docToken);
      if (!doc || doc.status === "revoked") return resp(404, { error: "not found" });
      if (doc.status === "pending" && doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      const obj = await docsS3().send(new GetObjectCommand({ Bucket: DOCS_BUCKET, Key: doc.s3Key }));
      const bytes = Buffer.from(await obj.Body.transformToByteArray());
      // Integrity self-check on EVERY serve: what we hand out must be exactly
      // what was registered (the hash the acceptance record freezes). A
      // mismatch means bucket tampering/corruption -- refuse to serve.
      if (sha256HexBytes(bytes) !== doc.sha256) {
        console.error("[ent/doc/pdf] stored-object hash mismatch for", qs.docToken?.slice(0, 8));
        return resp(500, { error: "INTERNAL" });
      }
      return resp(200, { fileName: doc.fileName, sha256: doc.sha256, pdfBase64: bytes.toString("base64") });
    }

    // Send/resend the acceptance OTP to the REGISTERED signer email (never a
    // caller-supplied address -- that binding is the identity check). Same
    // cooldown + rolling daily cap as the invite OTP flow.
    if (method === "POST" && path === "/ent/docs/otp/send") {
      const { docToken } = parsed;
      const doc = await getDoc(docToken);
      if (!doc || doc.status === "revoked") return resp(404, { error: "not found" });
      if (doc.status === "signed") return resp(409, { error: "ALREADY_SIGNED" });
      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (doc.otpLastSentAt && nowSec - doc.otpLastSentAt < OTP_SEND_COOLDOWN_SEC) {
        return resp(429, { error: "OTP_COOLDOWN", retryAfter: OTP_SEND_COOLDOWN_SEC - (nowSec - doc.otpLastSentAt) });
      }
      const windowStart = doc.otpSendWindowStart ?? 0;
      const inWindow = nowSec - windowStart < 24 * 3600;
      const priorCount = inWindow ? doc.otpSendCount ?? 0 : 0;
      if (priorCount >= OTP_SEND_DAILY_CAP) {
        return resp(429, { error: "OTP_DAILY_CAP" });
      }
      const code = String(randomInt(0, 1000000)).padStart(6, "0");
      await setDocOtp(docToken, code, {
        lastSentAt: nowSec,
        windowStart: inWindow ? windowStart : nowSec,
        sendCount: priorCount + 1,
      });
      const from = process.env.ENT_OTP_FROM;
      let emailed = false;
      if (from && doc.signerEmail) {
        try {
          await ses.send(
            new SendEmailCommand({
              Source: from,
              Destination: { ToAddresses: [doc.signerEmail] },
              Message: {
                Subject: { Data: "Your ShieldSync document acceptance code" },
                Body: {
                  Text: { Data: `Your one-time code to accept "${doc.title}" is ${code}. It expires in 10 minutes. If you did not expect this, you can ignore it.` },
                  Html: {
                    Data: `<div style="font-family:system-ui,sans-serif;color:#0f172a"><p>Your one-time code to accept the document:</p><p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#d97706">${code}</p><p style="color:#64748b">It expires in 10 minutes. If you did not expect this, you can ignore it.</p></div>`,
                  },
                },
              },
            })
          );
          emailed = true;
        } catch (e) {
          console.error("[ent/docs/otp/send] SES send failed:", e.name, e.message);
        }
      }
      const out = { ok: true, emailed, signerEmailMasked: maskEmail(doc.signerEmail) };
      // Plaintext code ONLY in local dev -- never in the Lambda runtime.
      if (!IN_LAMBDA) out.devCode = code;
      return resp(200, out);
    }

    // Accept: OTP verify + CAS pending->signed in ONE engine call (no verified-
    // but-unaccepted limbo). ip/userAgent are injected by the APP from request
    // headers server-side -- body values from the browser are never trusted.
    if (method === "POST" && path === "/ent/docs/accept") {
      const { docToken, code } = parsed;
      if (!docToken) return resp(400, { error: "DOC_TOKEN_REQUIRED" });
      const typedName = typeof parsed.typedName === "string" ? parsed.typedName.trim().slice(0, 120) : "";
      if (typedName.length < 2) return resp(400, { error: "NAME_REQUIRED" });
      if (typeof code !== "string" || !code.trim()) return resp(400, { error: "CODE_REQUIRED" });
      const ip = typeof parsed.ip === "string" ? parsed.ip.trim().slice(0, 64) : "";
      const userAgent = typeof parsed.userAgent === "string" ? parsed.userAgent.trim().slice(0, 400) : "";

      const r = await acceptDoc(docToken, code.trim(), { typedName, ip, userAgent });
      if (r.notFound) return resp(404, { error: "not found" });
      if (r.notAcceptable) {
        // Revoked (or raced into a non-pending, non-signed state): same
        // oracle-free 404 as every other route on this surface.
        return resp(404, { error: "not found" });
      }
      if (r.linkExpired) return resp(410, { error: "LINK_EXPIRED" });
      if (r.already) return resp(200, { ok: true, already: true, doc: sanitizeDocPublic(r.doc) });
      if (!r.ok) {
        // locked / expired (code TTL) / wrong code -- 200 + flags, the invite
        // OTP-verify contract the app UIs already know how to render.
        return resp(200, r);
      }

      console.log(
        JSON.stringify({ audit: true, action: "doc.accept", doc: docToken.slice(0, 8), acceptedName: r.doc.acceptedName, acceptedEmail: r.doc.acceptedEmail, sha256: r.doc.docHash, at: Date.now() })
      );
      await audit({
        orgId: DOCS_AUDIT_ORG,
        actor: r.doc.acceptedEmail,
        action: "doc.accept",
        target: docToken.slice(0, 8),
        detail: { title: r.doc.title, acceptedName: r.doc.acceptedName, sha256: r.doc.docHash, ip },
      });
      const { signerEmailed, opsEmailed } = await sendDocAcceptedEmails(r.doc, docToken);
      return resp(200, { ok: true, doc: sanitizeDocPublic(r.doc), signerEmailed, opsEmailed });
    }

    // Staff: kill a pending link (mistake / lost / renegotiated). A SIGNED
    // record is permanent and can never be revoked (409).
    if (method === "POST" && path === "/ent/docs/revoke") {
      const { docToken } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!docToken) return resp(400, { error: "DOC_TOKEN_REQUIRED" });
      try {
        const doc = await revokeDoc(docToken);
        if (!doc) return resp(404, { error: "not found" });
        console.log(
          JSON.stringify({ audit: true, action: "doc.revoke", actor, doc: docToken.slice(0, 8), at: Date.now() })
        );
        await audit({ orgId: DOCS_AUDIT_ORG, actor, action: "doc.revoke", target: docToken.slice(0, 8), detail: { title: doc.title } });
        return resp(200, { ok: true, revokedAt: doc.revokedAt });
      } catch (e) {
        if (e.code === "NOT_REVOCABLE") return resp(409, { error: "NOT_REVOCABLE", status: e.status });
        throw e;
      }
    }

    // Staff: re-send the signing-link email to the registered signer (pending
    // docs only; per-doc cooldown; never reveals the token to the admin UI).
    if (method === "POST" && path === "/ent/docs/resend") {
      const { docToken } = parsed;
      const actor = cleanActor(parsed.actor);
      if (!docToken) return resp(400, { error: "DOC_TOKEN_REQUIRED" });
      const doc = await getDoc(docToken);
      if (!doc || doc.status === "revoked") return resp(404, { error: "not found" });
      if (doc.status === "signed") return resp(409, { error: "ALREADY_SIGNED" });
      if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      if (doc.resendLastAt && nowSec - doc.resendLastAt < DOC_RESEND_COOLDOWN_SEC) {
        return resp(429, { error: "RESEND_COOLDOWN", retryAfter: DOC_RESEND_COOLDOWN_SEC - (nowSec - doc.resendLastAt) });
      }
      // Stamp BEFORE the send (setOtp precedent) so a failed send still throttles.
      await stampDocResend(docToken);
      const emailed = await sendDocSignLinkEmail({
        signerEmail: doc.signerEmail,
        signerName: doc.signerName,
        title: doc.title,
        docToken,
      });
      console.log(
        JSON.stringify({ audit: true, action: "doc.resend", actor, doc: docToken.slice(0, 8), emailed, at: Date.now() })
      );
      return resp(200, { ok: true, emailed });
    }

    // ── lab-leasing: reserved-capacity slot booking + timed assessment run ──
    if (method === "POST" && path === "/ent/slots") {
      const { inviteToken } = parsed;
      const invite = await getInvite(inviteToken);
      if (!invite) return resp(404, { error: "not found" });
      if (new Date(invite.expiresAt) < new Date()) {
        return resp(410, { error: "LINK_EXPIRED" });
      }
      // Azure labs have no scarce account pool — capacity is bounded by the
      // subscription, not a warm pool. Report a generous fixed cap so the app's
      // slot grid renders (never "scheduling opens soon" from an empty AWS pool).
      const slotAssess = await getAssessment(invite.assessmentId);
      if (slotAssess && entLabTrack(slotAssess.labSlug) === "azure") {
        return resp(200, { capacity: AZURE_SLOT_CAP, available: AZURE_SLOT_CAP });
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

      // Azure fork: no scarce AWS pool to gate on and no CloudFormation warm to
      // pre-provision (the RG is minted fresh at /ent/start). Book against a
      // generous fixed cap so the slot grid stays consistent, but NEVER consult
      // entReservedCounts() (AWS) or dispatch ensureWarmEnt (CloudFormation).
      const bookAssess = await getAssessment(invite.assessmentId);
      if (bookAssess && entLabTrack(bookAssess.labSlug) === "azure") {
        if (invite.status === "booked" && invite.slotKey && invite.slotKey !== slotKey) {
          await releaseSlot(invite.slotKey, inviteToken).catch(() => {});
        }
        const rAz = await bookSlot(slotKey, AZURE_SLOT_CAP, inviteToken);
        if (!rAz.ok) return resp(409, { error: "SLOT_FULL" });
        await setInviteStatus(inviteToken, "booked", { slotKey, slotAt: slotKey });
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

      // Azure fork: RG-per-session lifecycle (no pool, no warm) — handled entirely
      // in startAzureSession. Everything below this point is the AWS account-pool path.
      {
        const startAssess = await getAssessment(invite.assessmentId);
        if (startAssess && entLabTrack(startAssess.labSlug) === "azure") {
          return await startAzureSession({ invite, inviteToken, labSlug: startAssess.labSlug });
        }
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

      // ── Serialize the fresh lease ON THE INVITE (not just per-account) so two
      // concurrent starts can't each leaseEnt() a different sandbox account and
      // orphan one — a tiny-pool DoS. Exactly one concurrent start wins the claim.
      const claimed = await claimStartLease(inviteToken);
      if (!claimed) {
        // Another concurrent start is already leasing this invite. Re-read: if it
        // now holds a live session, reconnect the candidate to it; otherwise ask
        // the app to retry in a moment (it will land on the reconnect path above).
        const fresh = await getInvite(inviteToken);
        if (fresh?.sessionId) {
          const s2 = await getSession(fresh.sessionId);
          if (s2 && ["leasing", "active"].includes(s2.status) && new Date(s2.expiresAt) > new Date()) {
            const a2 = await getAssessment(fresh.assessmentId);
            const consoleUrl2 = await mintConsoleUrl({ accountId: s2.accountId, labSlug: a2?.labSlug, durationSeconds: 3600 });
            return resp(200, { sessionId: s2.sessionId, status: s2.status, consoleUrl: consoleUrl2, expiresAt: s2.expiresAt, reconnected: true });
          }
        }
        return resp(409, { error: "START_IN_PROGRESS", retry: true });
      }

      // ── Fresh start ──────────────────────────────────────────────────
      const assessment = await getAssessment(invite.assessmentId);
      const labSlug = assessment?.labSlug;
      const entUserId = "ent:" + inviteToken;

      let lease;
      try {
        lease = await leaseEnt(entUserId, labSlug, ENT_TIMEBOX_MIN + ENT_GRACE_MIN);
      } catch (e) {
        if (e.message === "NO_CAPACITY") {
          // Nothing leased — free the claim so the candidate's next poll retries
          // the lease immediately instead of eating 409s for START_CLAIM_TTL.
          await releaseStartClaim(inviteToken);
          return resp(503, { error: "NO_CAPACITY", retry: true });
        }
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

      // Azure fork: RG-based grade + teardown (graders.azure.mjs), handled entirely
      // in submitAzureSession. Everything below is the AWS account-pool submit path.
      if (entLabTrack(labSlug) === "azure") {
        return await submitAzureSession({ invite, inviteToken, labSlug, reflection, autoSubmitted });
      }

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
