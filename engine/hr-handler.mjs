// ShieldSync HR engine — AWS Lambda behind an API Gateway HTTP API. The
// PRODUCTION data plane for the internal HR portal (employee.shieldsyncsecurity.com),
// fully ISOLATED from the enterprise/labs engines: its OWN tables, its OWN
// SSE-KMS bucket, its OWN least-privilege IAM role (deploy/policy-hr.json).
//
// Implements the SAME /hr/* HTTP contract as the local dev server
// (engine/hr-server.mjs), so the Next app (lib/server/hr-engine.ts) is
// storage-agnostic. Auth: x-engine-token must equal HR_ENGINE_SECRET.
//
//   employees  -> DynamoDB ShieldSyncHrEmployees   (pk seq; item seq=0 = id counter)
//   documents  -> DynamoDB ShieldSyncHrDocuments   (pk employeeSeq, sk docId) + S3 bytes
//   audit      -> DynamoDB ShieldSyncHrAudit        (pk auditId)
//   KYC bytes  -> s3://shieldsync-hr-kyc-<acct>/emp/<seq>/<docId>  (SSE-KMS)
//
// KYC downloads stream THROUGH this Lambda (SHA-256 re-verified on serve) — the
// bucket blocks all public access and no object is ever directly reachable.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const ACCOUNT = process.env.PLATFORM_ACCOUNT ?? "750294427884";
const T_EMP = "ShieldSyncHrEmployees";
const T_DOC = "ShieldSyncHrDocuments";
const T_AUDIT = "ShieldSyncHrAudit";
// Hiring records live in their OWN table: a candidate is not staff, and under
// the DPDP Act their data has a different stated purpose and a shorter life.
const T_CAND = "ShieldSyncHrCandidates";
// Imported bank transactions (pk = deterministic row hash, so re-import is idempotent).
const T_BANK = "ShieldSyncHrBanking";
const BUCKET = process.env.HR_KYC_BUCKET ?? `shieldsync-hr-kyc-${ACCOUNT}`;
// Dedicated CMK for KYC (alias created by create-hr-kyc-infra.mjs).
const KMS_KEY = process.env.HR_KMS_KEY_ID ?? "alias/shieldsync-hr-kyc";
// 4 MB hard cap: bytes travel as base64 inside JSON, and the synchronous
// Lambda invoke payload tops out at 6 MB each way — 4 MB * 4/3 = ~5.4 MB keeps
// uploads AND downloads deliverable. (An 8 MB cap would pass dev and 502 in prod.)
const MAX_BYTES = 4 * 1024 * 1024;

const KYC_KINDS = new Set(["aadhaar", "pan", "bank_proof", "photo", "signed_offer", "education", "experience", "other"]);

// Magic-byte sniffing — the declared content type is untrusted input.
function sniffType(bytes) {
  if (bytes.length >= 5 && bytes.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (bytes.length >= 12 && bytes.slice(0, 4).toString("latin1") === "RIFF" && bytes.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Delete EVERY version of an object — on a versioned bucket a plain delete
 * only writes a delete marker, leaving KYC bytes recoverable forever. DPDP
 * erasure must be real. */
async function purgeAllVersions(key) {
  const listed = await s3.send(new ListObjectVersionsCommand({ Bucket: BUCKET, Prefix: key }));
  const targets = [
    ...(listed.Versions ?? []).filter((v) => v.Key === key),
    ...(listed.DeleteMarkers ?? []).filter((v) => v.Key === key),
  ];
  for (const v of targets) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key, VersionId: v.VersionId }));
  }
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region: REGION });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function resp(status, obj) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

// Branded HTML for a document-delivery email (letters/certificates/payslips
// sent from the portal). Table-based layout with every style inline — that's
// not house style, it's a compatibility requirement: Gmail, Outlook, and most
// mobile mail apps strip <style> blocks and flexbox/grid from email HTML, so
// anything not inlined silently reverts to unstyled text in exactly the
// clients this needs to look right in.
// EVERY interpolation below is esc()'d. The subject is caller-supplied and
// reaches here from the self-serve document viewer too — i.e. the lowest-trust
// authenticated principal in the system — so unescaped HTML here would let
// someone inject styled links into a genuine, DKIM-signed email from our own
// domain. A benign subject containing "<" would also silently eat the layout.
// cta.url is additionally scheme-checked: only https links become a button.
function documentEmailHtml({ recipientName, subjectLine, note, cta }) {
  const navy = "#1f3a5f";
  const muted = "#5b6676";
  const ctaUrl = cta && typeof cta.url === "string" && /^https:\/\//i.test(cta.url) ? cta.url : null;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef2f8;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f8;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #d9dfea;">
<tr><td style="background:${navy};padding:20px 28px;">
<span style="color:#ffffff;font-size:18px;font-weight:700;">ShieldSync Security</span><br>
<span style="color:#c7d2e6;font-size:12px;">Empowering Cybersecurity Futures</span>
</td></tr>
<tr><td style="padding:28px;">
<p style="margin:0 0 16px;color:#1b2331;font-size:14px;line-height:1.6;">Dear ${esc(recipientName)},</p>
<p style="margin:0 0 16px;color:#1b2331;font-size:14px;line-height:1.6;">Please find your document attached:</p>
<p style="margin:0 0 20px;padding:12px 16px;background:#f4f7fb;border-left:3px solid ${navy};color:${navy};font-size:14px;font-weight:700;">${esc(subjectLine)}</p>
${note ? `<p style="margin:0 0 16px;padding:12px 16px;background:#fdf4e3;border-left:3px solid #c99a2e;color:#7a5714;font-size:13px;line-height:1.6;">${esc(note)}</p>` : ""}
${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="border-radius:8px;background:${navy};">
<a href="${esc(ctaUrl)}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-size:14.5px;font-weight:700;text-decoration:none;">${esc(cta.label)}</a>
</td></tr></table>` : ""}
<p style="margin:0 0 8px;color:#1b2331;font-size:14px;line-height:1.6;">If you have any questions, just reply to this email or write to
<a href="mailto:info@shieldsyncsecurity.com" style="color:${navy};">info@shieldsyncsecurity.com</a>.</p>
<p style="margin:24px 0 0;color:#1b2331;font-size:14px;line-height:1.6;">Regards,<br>ShieldSync Security Private Limited</p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eef2f7;">
<p style="margin:0;color:${muted};font-size:11px;line-height:1.6;">This is an automated message from the ShieldSync HR portal. Please do not share this email or its attachment with anyone other than the intended recipient.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function writeAudit(actor, action, target, detail) {
  await ddb.send(
    new PutCommand({
      TableName: T_AUDIT,
      Item: {
        auditId: `a_${Date.now()}_${randomUUID().slice(0, 8)}`,
        actor: actor || "unknown",
        action,
        target: target || "",
        detail: detail || {},
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Email the owner a candidate's questionnaire answers the moment they submit.
 *
 * Sends the ANSWERS, not a "you have a new submission" nudge — a notification
 * that only tells you to go and log in is a notification you postpone. The
 * question ids are rendered as-is rather than resolved to their labels: the
 * labels live in the Next app's questionnaire definition, and duplicating them
 * here would create a second copy to drift out of sync every time the owner
 * edits a question.
 *
 * Failure here must never fail the submission — the candidate has already
 * pressed submit and their answers are stored; a mail outage is our problem,
 * not a reason to show them an error.
 */
async function notifySubmission(cand, answers) {
  try {
    const to = (process.env.HR_SUBMISSION_TO || process.env.HR_REMINDER_TO || "").trim();
    const key = process.env.RESEND_API_KEY;
    if (!to || !key) {
      console.warn(`[hr] questionnaire submitted by ${cand.candidateId} but ${!to ? "HR_SUBMISSION_TO" : "RESEND_API_KEY"} is unset`);
      return;
    }
    const portal = process.env.HR_PORTAL_URL || "https://employee.shieldsyncsecurity.com";
    const entries = Object.entries(answers ?? {});

    const rows = entries
      .map(([q, a]) => {
        const value = Array.isArray(a) ? a.join(", ") : String(a ?? "");
        return (
          `<tr>` +
          `<td style="padding:9px 12px;border-bottom:1px solid #eef2f7;font-size:12px;color:#5b6676;vertical-align:top;width:34%">${esc(q)}</td>` +
          `<td style="padding:9px 12px;border-bottom:1px solid #eef2f7;font-size:13px;color:#1b2331;white-space:pre-wrap">${esc(value) || "<i>(blank)</i>"}</td>` +
          `</tr>`
        );
      })
      .join("");

    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px">` +
      `<h2 style="color:#1f3a5f;font-size:18px;margin:0 0 4px">${esc(cand.name)} completed the questionnaire</h2>` +
      `<p style="font-size:13px;color:#5b6676;margin:0 0 14px">` +
      `${esc(cand.candidateId)} · ${esc(cand.roleAppliedFor)} · ${esc(cand.email)}` +
      `${cand.salaryProof ? ` · salary proof attached in the portal (${esc(cand.salaryProof.fileName)})` : " · no salary proof uploaded"}` +
      `</p>` +
      `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f2;border-radius:8px">${rows}</table>` +
      `<p style="font-size:13px;margin:16px 0 0">` +
      `<a href="${portal}/manage-candidates/${cand.seq}" style="color:#2f4fb0;font-weight:700">Open ${esc(cand.name.split(" ")[0])} in the portal &rarr;</a>` +
      `</p>` +
      `<p style="font-size:11px;color:#8a94a3;margin-top:18px">${entries.length} answers · submitted ${new Date().toISOString()}</p>` +
      `</div>`;

    const text =
      `${cand.name} completed the questionnaire\n${cand.candidateId} · ${cand.roleAppliedFor} · ${cand.email}\n\n` +
      entries.map(([q, a]) => `${q}:\n${Array.isArray(a) ? a.join(", ") : a}\n`).join("\n") +
      `\n${portal}/manage-candidates/${cand.seq}\n`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10000), // don't let a hung Resend call block the Lambda indefinitely
      body: JSON.stringify({
        from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `${cand.name} completed the questionnaire — ${cand.roleAppliedFor}`,
        html,
        text,
      }),
    });
    if (!r.ok) console.warn(`[hr] submission notification failed: ${r.status}`);
    else await writeAudit("system", "candidate.submission.notify", cand.candidateId, { to });
  } catch (e) {
    console.warn(`[hr] submission notification threw: ${e?.message ?? e}`);
  }
}

/**
 * The self-serve PIN credential — a salted SHA-256 hash, its salt, and the
 * brute-force counters. These are LOGIN SECRETS, not record fields: nothing
 * outside this engine has any use for them, and the single-round hash over a
 * 4-8 digit PIN would be an offline crack of seconds if it ever escaped.
 *
 * Stripped centrally on the way OUT, because the leak was never in one place:
 * a record edit, an offboard, and a create all echoed the whole DynamoDB item
 * back to the caller. Read paths inside the engine (login, /self-pin) use the
 * raw item and are unaffected.
 */
const PIN_SECRET_FIELDS = ["selfPinHash", "selfPinSalt", "selfFailedAttempts", "selfLockedUntil"];
function publicEmployee(item) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  for (const f of PIN_SECRET_FIELDS) delete out[f];
  // The UI still needs to know WHETHER a PIN exists (to say "set up" vs
  // "reissue", and to warn before replacing one) — that is a boolean, not a
  // credential, so it is derived here rather than leaking the hash to infer it.
  out.hasSelfPin = Boolean(item.selfPinHash);
  return out;
}

/** Only an OFFER can be "accepted". Without this, the public accept URL
 * resolves for any issued document — a payslip, an experience letter — and
 * would stamp acceptance on it under page copy about signing an offer on your
 * joining date. Enforced on both the GET and the POST so neither leaks the
 * existence of a non-offer document. */
const ACCEPTABLE_DOCTYPES = new Set(["offer", "internship-offer"]);

/** Best-effort admin alert when a candidate clicks "I Accept" — same
 * fire-and-forget shape as notifySubmission() above; never blocks the accept. */
async function notifyAccept(emp, gen, acceptedName) {
  try {
    const to = (process.env.HR_SUBMISSION_TO || process.env.HR_REMINDER_TO || "").trim();
    const key = process.env.RESEND_API_KEY;
    if (!to || !key) {
      // Must be loud: this email is the ONLY proactive signal that someone
      // accepted. Silently returning would mean a misconfigured env var loses
      // acceptances with nothing in CloudWatch to explain it.
      console.warn(`[hr] ${emp?.name ?? "someone"} accepted ${gen?.ref ?? ""} but ${!to ? "HR_SUBMISSION_TO" : "RESEND_API_KEY"} is unset — no alert sent`);
      return;
    }
    const portal = process.env.HR_PORTAL_URL || "https://employee.shieldsyncsecurity.com";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10000), // don't let a hung Resend call block the Lambda indefinitely
      body: JSON.stringify({
        from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: `${emp.name} accepted ${gen.title || gen.docType} — ${gen.ref}`,
        html:
          `<div style="font-family:Arial,Helvetica,sans-serif">` +
          `<p style="font-size:14px;color:#1b2331">Someone clicked <b>I Accept</b> on ${esc(gen.title || gen.docType)} (${esc(gen.ref)}), issued to ${esc(emp.name)}.</p>` +
          `<p style="font-size:14px;color:#1b2331">Name typed on the confirmation: <b>${esc(acceptedName || "(not provided)")}</b></p>` +
          `<p style="font-size:13px"><a href="${portal}/employees/${emp.seq}/issued/${gen.docId}" style="color:#2f4fb0;font-weight:700">Open the document &rarr;</a></p>` +
          `<p style="font-size:11.5px;color:#5b6676">This is an acknowledgment that the emailed copy was seen and agreed to — not a verified signature. The signed physical original remains the record.</p>` +
          `</div>`,
        text: `Someone clicked I Accept on ${gen.title || gen.docType} (${gen.ref}), issued to ${emp.name}. Name typed: ${acceptedName || "(not provided)"}.\n${portal}/employees/${emp.seq}/issued/${gen.docId}`,
      }),
    });
    if (!r.ok) console.warn(`[hr] accept notification failed: ${r.status}`);
  } catch (e) {
    console.warn(`[hr] accept notification threw: ${e?.message ?? e}`);
  }
}

/**
 * Daily "someone hasn't been paid" reminder.
 *
 * Salary for a month is DUE once that month has closed: an active employee with
 * no issued payslip whose ref ends " YYYY-MM". Same rule the portal's banner and
 * the /payslips table use, so all three always agree.
 *
 * Sends nothing when payroll is clear — a mail that arrives every day regardless
 * gets filtered, and then the one that matters gets filtered too.
 */
async function runPayrollReminder(now = new Date()) {
  const d = new Date(now);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleString("en-GB", { month: "long", year: "numeric" });

  // Paginated -- an unpaginated Scan would silently stop considering employees
  // past DynamoDB's ~1MB/call cap, under-reporting who's unpaid with no error.
  const empItems = [];
  {
    let startKey;
    do {
      const out = await ddb.send(new ScanCommand({ TableName: T_EMP, ExclusiveStartKey: startKey }));
      empItems.push(...(out.Items ?? []));
      startKey = out.LastEvaluatedKey;
    } while (startKey);
  }
  const emps = { Items: empItems };
  // Anyone who joined AFTER the pay month can't owe a payslip for it — hire
  // someone on 1 August and this would otherwise demand a July slip for them.
  // Mirrors joinedMonth() in hr/lib/server/payroll-due.ts; the two must agree.
  const joinedMonth = (e) => {
    const t = Date.parse(e.dateOfJoining ?? "");
    if (Number.isNaN(t)) return null; // unreadable date -> still remind, never excuse
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  // People deliberately outside the payslip run (e.g. a director paid another
  // way). Comma-separated names or employee IDs in HR_REMINDER_EXCLUDE, matched
  // case/space-insensitively. Keep in sync with hr/lib/server/payroll-due.ts.
  const excluded = new Set(
    (process.env.HR_REMINDER_EXCLUDE ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
      .filter(Boolean),
  );
  const isExcluded = (e) =>
    excluded.has(String(e.name ?? "").trim().toLowerCase().replace(/\s+/g, " ")) ||
    excluded.has(String(e.employeeId ?? "").trim().toLowerCase());

  const active = (emps.Items ?? []).filter((i) => {
    if (!(i.seq > 0) || i.status === "exited") return false;
    if (isExcluded(i)) return false;
    const j = joinedMonth(i);
    return j === null || j <= month;
  });

  // Parallelized -- DynamoDB has no batch-query-by-partition, so awaiting these
  // concurrently (rather than one at a time in a for-loop) is the fix: N
  // independent round-trips in parallel instead of N sequential ones.
  const dueChecks = await Promise.all(
    active.map(async (e) => {
      const docs = await ddb.send(
        new QueryCommand({ TableName: T_DOC, KeyConditionExpression: "employeeSeq = :s", ExpressionAttributeValues: { ":s": e.seq } }),
      );
      const paid = (docs.Items ?? []).some(
        (x) => x.category === "generated" && x.docType === "payslip" && typeof x.ref === "string" && x.ref.endsWith(` ${month}`),
      );
      return paid ? null : { seq: e.seq, name: e.name, employeeId: e.employeeId };
    }),
  );
  const due = dueChecks.filter(Boolean);

  if (due.length === 0) return resp(200, { month, due: 0, sent: false, reason: "PAYROLL_CLEAR" });

  const to = process.env.HR_REMINDER_TO;
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) {
    // Still useful: the portal banner covers the human, and this line tells us
    // in CloudWatch that the email half is unconfigured rather than silent.
    console.warn(`[hr] payroll reminder: ${due.length} unpaid for ${month} but ${!to ? "HR_REMINDER_TO" : "RESEND_API_KEY"} is unset`);
    return resp(200, { month, due: due.length, sent: false, reason: "EMAIL_NOT_CONFIGURED" });
  }

  // Day 1 of the new month = 1 day since the pay month closed.
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysSince = Math.max(0, Math.floor((now - startOfThisMonth) / 86400000) + 1);
  const overdue = daysSince > 7;
  const lines = due.map((x) => `  - ${x.name}${x.employeeId ? ` (${x.employeeId})` : ""}`).join("\n");
  const portal = process.env.HR_PORTAL_URL || "https://hr.shieldsyncsecurity.com";

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(10000), // don't let a hung Resend call block the Lambda indefinitely
    body: JSON.stringify({
      from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
      to: to.split(",").map((s) => s.trim()).filter(Boolean),
      subject: `${overdue ? "OVERDUE" : "Due"}: salary for ${label} — ${due.length} unpaid`,
      text:
        `Salary for ${label} is ${overdue ? `OVERDUE (${daysSince} days since the month closed)` : "due"}.\n\n` +
        `${due.length} of ${active.length} active ${due.length === 1 ? "person has" : "people have"} no payslip issued yet:\n\n${lines}\n\n` +
        `Run payroll: ${portal}/payslips?month=${month}\n\n` +
        `You are getting this because someone is still unpaid — it stops as soon as every payslip is issued.\n` +
        `— ShieldSync Security Private Limited (HR)`,
    }),
  });
  if (!r.ok) {
    console.error("[hr] payroll reminder send failed", r.status);
    return resp(502, { error: "SEND_FAILED", status: r.status, month, due: due.length });
  }
  await writeAudit("system", "payroll.reminder", month, { due: due.length, overdue });
  return resp(200, { month, due: due.length, sent: true, overdue });
}

export async function handler(event) {
  // Scheduled invoke (EventBridge -> Lambda). Checked BEFORE the token gate: a
  // cron event carries no headers, and the invoke is already authorised by IAM,
  // which is the correct trust boundary for it. It is NOT reachable over HTTP —
  // API Gateway requests always carry rawPath, so they can never match here.
  if (event?.job === "payroll-reminder" || (event?.["detail-type"] === "Scheduled Event" && !event?.rawPath)) {
    return await runPayrollReminder();
  }

  // Liveness probe — BEFORE the token gate; returns no data.
  if ((event.rawPath ?? "/") === "/hr/health") return resp(200, { ok: true });

  // Engine-token gate: fail closed, refuse weak secrets, compare in constant
  // time (digest-then-timingSafeEqual so length never leaks either).
  const secret = process.env.HR_ENGINE_SECRET ?? "";
  const token = event.headers?.["x-engine-token"] ?? event.headers?.["X-Engine-Token"] ?? "";
  if (secret.length < 32) {
    console.error("[hr] HR_ENGINE_SECRET missing or under 32 chars — refusing all requests");
    return resp(503, { error: "ENGINE_MISCONFIGURED" });
  }
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!timingSafeEqual(a, b)) {
    return resp(401, { error: "BAD_TOKEN" });
  }

  const method = event.requestContext?.http?.method ?? "GET";
  const rawPath = event.rawPath ?? "/";
  const parts = rawPath.split("/").filter(Boolean); // ["hr","employees",...]
  const qs = event.queryStringParameters ?? {};
  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
    } catch {
      body = {};
    }
  }

  try {
    // ---- /hr/employees ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length === 2) {
      if (method === "GET") {
        // Paginated (matches /hr/candidates, /hr/audit, /hr/banking) -- a plain
        // single Scan silently truncates past DynamoDB's ~1MB/call cap, which
        // would drop employees off the list with no error as the table grows.
        const items = [];
        let startKey;
        do {
          const out = await ddb.send(new ScanCommand({ TableName: T_EMP, ExclusiveStartKey: startKey }));
          items.push(...(out.Items ?? []));
          startKey = out.LastEvaluatedKey;
        } while (startKey);
        // seq <= 0 rows are counters (0 = employee ids; negatives = letter-ref series).
        const employees = items.filter((i) => i.seq > 0).sort((a, b) => a.seq - b.seq);
        return resp(200, { employees: employees.map(publicEmployee) });
      }
      if (method === "POST") {
        // Atomic id counter lives at seq=0.
        const c = await ddb.send(
          new UpdateCommand({
            TableName: T_EMP,
            Key: { seq: 0 },
            UpdateExpression: "ADD #c :one",
            ExpressionAttributeNames: { "#c": "counter" },
            ExpressionAttributeValues: { ":one": 1 },
            ReturnValues: "UPDATED_NEW",
          }),
        );
        const seq = c.Attributes.counter;
        const now = new Date().toISOString();
        const employee = { ...body.employee, employeeId: `SSS/EMP/${String(seq).padStart(4, "0")}`, seq, createdAt: now, updatedAt: now };
        await ddb.send(new PutCommand({ TableName: T_EMP, Item: employee }));
        await writeAudit(body.actor, "employee.create", employee.employeeId, { name: employee.name });
        return resp(200, { employee: publicEmployee(employee) });
      }
    }

    // GUARD for every /hr/employees/:seq* route: seq must be a positive
    // integer. seq=0 and negative seqs are COUNTER items (employee ids, letter
    // series) — without this, DELETE /hr/employees/0 would destroy the id
    // counter and restart SSS/EMP numbering into collisions.
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length >= 3) {
      const s = Number(parts[2]);
      if (!Number.isInteger(s) || s <= 0) return resp(404, { error: "NOT_FOUND" });
    }

    // ---- /hr/employees/:seq ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length === 3) {
      const seq = Number(parts[2]);
      if (method === "GET") {
        const out = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
        if (!out.Item) return resp(404, { error: "NOT_FOUND" });
        return resp(200, { employee: publicEmployee(out.Item) });
      }
      if (method === "PUT") {
        const cur = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
        if (!cur.Item) return resp(404, { error: "NOT_FOUND" });
        const employee = {
          ...cur.Item,
          ...body.employee,
          seq,
          employeeId: cur.Item.employeeId,
          // Status + LWD change ONLY via /status — an edit must never silently
          // reactivate an exited employee.
          status: cur.Item.status ?? "active",
          lastWorkingDay: cur.Item.lastWorkingDay,
          // The self-serve PIN credential and its brute-force counters are
          // engine-owned, exactly like status: they change only via /self-pin
          // and the login handler. Without pinning them, a generic record edit
          // that echoes back a previously-read employee object would silently
          // reinstate a stale PIN hash or clear an active lockout.
          selfPinHash: cur.Item.selfPinHash,
          selfPinSalt: cur.Item.selfPinSalt,
          selfFailedAttempts: cur.Item.selfFailedAttempts,
          selfLockedUntil: cur.Item.selfLockedUntil,
          createdAt: cur.Item.createdAt,
          updatedAt: new Date().toISOString(),
        };
        try {
          // Optimistic lock: refuse when the record changed since the caller's
          // form was loaded (two HR users; last-write-wins loses data silently).
          await ddb.send(
            new PutCommand({
              TableName: T_EMP,
              Item: employee,
              ...(body.expectedUpdatedAt
                ? {
                    ConditionExpression: "updatedAt = :exp",
                    ExpressionAttributeValues: { ":exp": body.expectedUpdatedAt },
                  }
                : {}),
            }),
          );
        } catch (e) {
          if (e.name === "ConditionalCheckFailedException") {
            return resp(409, { error: "STALE", updatedAt: cur.Item.updatedAt });
          }
          throw e;
        }
        const grossChanged = cur.Item.grossMonthly !== employee.grossMonthly;
        await writeAudit(body.actor, "employee.update", employee.employeeId, grossChanged ? { grossFrom: cur.Item.grossMonthly, grossTo: employee.grossMonthly } : {});
        return resp(200, { employee: publicEmployee(employee) });
      }
      if (method === "DELETE") {
        const cur = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
        if (!cur.Item) return resp(404, { error: "NOT_FOUND" });
        // Cascade: delete this employee's KYC objects (S3) + metadata (DDB).
        const docs = await ddb.send(
          new QueryCommand({
            TableName: T_DOC,
            KeyConditionExpression: "employeeSeq = :s",
            ExpressionAttributeValues: { ":s": seq },
          }),
        );
        for (const d of docs.Items ?? []) {
          try {
            if (d.s3Key) await purgeAllVersions(d.s3Key); // real erasure (all versions)
          } catch {}
          await ddb.send(new DeleteCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: d.docId } }));
        }
        await ddb.send(new DeleteCommand({ TableName: T_EMP, Key: { seq } }));
        await writeAudit(body.actor, "employee.delete", cur.Item.employeeId, { name: cur.Item.name, removedDocs: (docs.Items ?? []).length });
        return resp(200, { ok: true, removedDocs: (docs.Items ?? []).length });
      }
    }

    // ---- /hr/employees/:seq/docs (KYC) ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "docs") {
      const seq = Number(parts[2]);

      if (parts.length === 4 && method === "POST") {
        const bytes = Buffer.from(body.base64 || "", "base64");
        if (bytes.length === 0) return resp(400, { error: "EMPTY" });
        if (bytes.length > MAX_BYTES) return resp(400, { error: "TOO_LARGE" });
        // Server-side magic-byte check — never trust the declared content type.
        const sniffed = sniffType(bytes);
        if (!sniffed) return resp(400, { error: "BAD_FILE_TYPE" });
        body.contentType = sniffed;
        if (!KYC_KINDS.has(body.kind)) body.kind = "other";
        const docId = `d_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const key = `emp/${seq}/${docId}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: bytes,
            ContentType: sniffed,
            ServerSideEncryption: "aws:kms",
            SSEKMSKeyId: KMS_KEY,
          }),
        );
        const doc = {
          employeeSeq: seq,
          docId,
          category: "kyc",
          kind: body.kind || "other",
          label: body.label || "",
          fileName: body.fileName || "file",
          contentType: body.contentType || "application/octet-stream",
          sizeBytes: bytes.length,
          sha256: sha256(bytes),
          s3Key: key,
          uploadedBy: body.actor || "unknown",
          uploadedAt: new Date().toISOString(),
        };
        await ddb.send(new PutCommand({ TableName: T_DOC, Item: doc }));
        await writeAudit(body.actor, "kyc.upload", `${seq}/${docId}`, { kind: doc.kind, fileName: doc.fileName });
        return resp(200, { doc });
      }

      if (parts.length === 4 && method === "GET") {
        const out = await ddb.send(
          new QueryCommand({
            TableName: T_DOC,
            KeyConditionExpression: "employeeSeq = :s",
            ExpressionAttributeValues: { ":s": seq },
          }),
        );
        return resp(200, { docs: (out.Items ?? []).filter((d) => d.category !== "generated") });
      }

      if (parts.length === 6 && parts[5] === "content" && method === "GET") {
        const docId = parts[4];
        const meta = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId } }));
        if (!meta.Item) return resp(404, { error: "NOT_FOUND" });
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: meta.Item.s3Key }));
        const bytes = Buffer.from(await obj.Body.transformToByteArray());
        if (sha256(bytes) !== meta.Item.sha256) return resp(500, { error: "HASH_MISMATCH" });
        // Actor rides in a header (never the query string — URLs land in logs).
        const dlActor = event.headers?.["x-hr-actor"] ?? event.headers?.["X-Hr-Actor"] ?? qs.actor;
        await writeAudit(dlActor, "kyc.download", `${seq}/${docId}`, { fileName: meta.Item.fileName });
        return resp(200, { contentType: meta.Item.contentType, fileName: meta.Item.fileName, base64: bytes.toString("base64") });
      }

      if (parts.length === 5 && method === "DELETE") {
        const docId = parts[4];
        const meta = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId } }));
        if (!meta.Item) return resp(404, { error: "NOT_FOUND" });
        // REAL erasure: purge every S3 version, not just a delete marker.
        if (meta.Item.s3Key) await purgeAllVersions(meta.Item.s3Key);
        await ddb.send(new DeleteCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId } }));
        await writeAudit(body.actor, "kyc.delete", `${seq}/${docId}`, { fileName: meta.Item.fileName });
        return resp(200, { ok: true });
      }
    }

    // ---- /hr/employees/:seq/status (offboard / reactivate) ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "status" && parts.length === 4 && method === "POST") {
      const seq = Number(parts[2]);
      const status = body.status === "exited" ? "exited" : "active";
      // Field-scoped update: touch ONLY status/lastWorkingDay/updatedAt. A full
      // get-then-Put here would silently write back stale values over a
      // concurrent locked edit — the exact race the PUT route's optimistic
      // lock exists to prevent.
      let out;
      try {
        out = await ddb.send(
          new UpdateCommand({
            TableName: T_EMP,
            Key: { seq },
            ConditionExpression: "attribute_exists(#s)",
            UpdateExpression:
              status === "exited"
                ? "SET #st = :st, lastWorkingDay = :lwd, updatedAt = :u"
                : "SET #st = :st, updatedAt = :u REMOVE lastWorkingDay",
            ExpressionAttributeNames: { "#st": "status", "#s": "seq" },
            ExpressionAttributeValues: {
              ":st": status,
              ":u": new Date().toISOString(),
              ...(status === "exited" ? { ":lwd": body.lastWorkingDay || "" } : {}),
            },
            ReturnValues: "ALL_NEW",
          }),
        );
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") return resp(404, { error: "NOT_FOUND" });
        throw e;
      }
      const employee = out.Attributes;
      await writeAudit(body.actor, status === "exited" ? "employee.offboard" : "employee.reactivate", employee.employeeId, { lastWorkingDay: employee.lastWorkingDay });
      // ALL_NEW returns the ENTIRE item, including the PIN credential — this is
      // reachable from the plain "Mark exited" button, so it must be stripped.
      return resp(200, { employee: publicEmployee(employee) });
    }

    // ---- /hr/employees/:seq/self-pin — admin sets/resets the self-serve PIN ----
    // Field-scoped update, same reasoning as /status: never touch the rest of
    // the record. A fresh salt on every (re)set means a leaked old hash can
    // never be replayed once the PIN is changed.
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "self-pin" && parts.length === 4 && method === "POST") {
      const seq = Number(parts[2]);
      const pin = String(body.pin ?? "").trim();
      if (!/^\d{4,8}$/.test(pin)) return resp(400, { error: "BAD_PIN" });
      const salt = randomBytes(16).toString("hex");
      const pinHash = sha256(Buffer.from(salt + pin));
      let out;
      try {
        out = await ddb.send(
          new UpdateCommand({
            TableName: T_EMP,
            Key: { seq },
            ConditionExpression: "attribute_exists(#s)",
            UpdateExpression: "SET selfPinHash = :h, selfPinSalt = :salt, selfFailedAttempts = :z, updatedAt = :u REMOVE selfLockedUntil",
            ExpressionAttributeNames: { "#s": "seq" },
            ExpressionAttributeValues: { ":h": pinHash, ":salt": salt, ":z": 0, ":u": new Date().toISOString() },
            ReturnValues: "ALL_NEW",
          }),
        );
      } catch (e) {
        if (e.name === "ConditionalCheckFailedException") return resp(404, { error: "NOT_FOUND" });
        throw e;
      }
      await writeAudit(body.actor, "employee.self-pin.set", out.Attributes.employeeId, {});
      return resp(200, { ok: true });
    }

    // ---- /hr/self/login — PUBLIC self-serve surface, Employee ID + PIN ----
    // Reachable without an HR session (same shape as the questionnaire hole
    // below): the caller proves identity with the PIN, not a cookie. Locks
    // after 5 bad attempts for 15 minutes — a PIN is much lower-entropy than
    // the 192-bit questionnaire token, so this endpoint (not the hash) is the
    // real defence against guessing.
    if (parts[0] === "hr" && parts[1] === "self" && parts[2] === "login" && parts.length === 3 && method === "POST") {
      // Constant-time floor across the 401 paths: a non-provisioned account
      // returns after one GetCommand, but a wrong PIN on a REAL account does
      // sha256 + timingSafeEqual + two DynamoDB writes first. Without a floor,
      // an attacker sweeping SSS/EMP/<n> distinguishes provisioned accounts by
      // latency. Every INVALID reply now takes the same minimum wall-clock time.
      const t0 = Date.now();
      const replyInvalid = async () => {
        const wait = 250 - (Date.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        return resp(401, { error: "INVALID" });
      };
      const m = /^SSS\/EMP\/(\d+)$/i.exec(String(body.employeeId ?? "").trim());
      const pin = String(body.pin ?? "").trim();
      if (!m || !pin) return await replyInvalid();
      const seq = Number(m[1]);
      const emp = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }))).Item;
      if (!emp || !emp.selfPinHash) return await replyInvalid();
      if (emp.selfLockedUntil && new Date(emp.selfLockedUntil) > new Date()) {
        return resp(423, { error: "LOCKED", until: emp.selfLockedUntil });
      }
      const a = Buffer.from(emp.selfPinHash, "hex");
      const b = Buffer.from(sha256(Buffer.from((emp.selfPinSalt || "") + pin)), "hex");
      const ok = a.length === b.length && timingSafeEqual(a, b);
      if (!ok) {
        // If a previous lock has already EXPIRED, start a FRESH attempt window
        // rather than carrying the old count forward. Otherwise one wrong PIN
        // after each 15-min lock re-locks (5+1 >= 5) indefinitely — a targeted
        // DoS against a guessable employee id with one request every 15 min.
        // Below the threshold we also REMOVE any stale expired lock so the
        // counter can accumulate a clean 1..5 window.
        const priorLockExpired = emp.selfLockedUntil && new Date(emp.selfLockedUntil) <= new Date();
        const attempts = (priorLockExpired ? 0 : emp.selfFailedAttempts || 0) + 1;
        const locked = attempts >= 5;
        await ddb.send(
          new UpdateCommand({
            TableName: T_EMP,
            Key: { seq },
            UpdateExpression: locked
              ? "SET selfFailedAttempts = :a, selfLockedUntil = :lu"
              : "SET selfFailedAttempts = :a REMOVE selfLockedUntil",
            ExpressionAttributeValues: locked
              ? { ":a": attempts, ":lu": new Date(Date.now() + 15 * 60 * 1000).toISOString() }
              : { ":a": attempts },
          }),
        );
        await writeAudit("self-serve", "self.login.fail", emp.employeeId, { attempts, locked });
        return await replyInvalid();
      }
      await ddb.send(
        new UpdateCommand({
          TableName: T_EMP,
          Key: { seq },
          UpdateExpression: "SET selfFailedAttempts = :z REMOVE selfLockedUntil",
          ExpressionAttributeValues: { ":z": 0 },
        }),
      );
      await writeAudit("self-serve", "self.login.success", emp.employeeId, {});
      return resp(200, { seq, name: emp.name });
    }

    // ---- /hr/employees/:seq/generated (issued-document history) ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "generated") {
      const seq = Number(parts[2]);
      if (parts.length === 4 && method === "POST") {
        const genId = `g_${Date.now()}_${randomUUID().slice(0, 8)}`;
        // Unified reference series (SSS/HR|SSS/INT / <year> / NNN): the REAL ref
        // is allocated atomically at issue time via a counter item in the
        // employees table (negative seq keys are reserved for counters; the
        // "hr" 2026 counter is seeded at 14 by create-hr-tables.mjs to continue
        // the manually issued series). Page views only preview a provisional ref.
        let ref = body.ref || "";
        const snapshot = body.snapshot ?? {};
        if (body.refSeries === "hr" || body.refSeries === "int") {
          const year = Number(body.refYear) || new Date().getFullYear();
          const counterKey = -(year * 10 + (body.refSeries === "int" ? 1 : 0));
          const c = await ddb.send(
            new UpdateCommand({
              TableName: T_EMP,
              Key: { seq: counterKey },
              UpdateExpression: "ADD #c :one",
              ExpressionAttributeNames: { "#c": "counter" },
              ExpressionAttributeValues: { ":one": 1 },
              ReturnValues: "UPDATED_NEW",
            }),
          );
          const prefix = body.refSeries === "int" ? "SSS/INT" : "SSS/HR";
          ref = `${prefix}/${year}/${String(c.Attributes.counter).padStart(3, "0")}`;
          if (snapshot && typeof snapshot === "object") snapshot.ref = ref;
        }
        const rec = {
          employeeSeq: seq,
          docId: genId,
          category: "generated",
          docType: body.docType || "document",
          title: body.title || "",
          ref,
          snapshotVersion: 1,
          snapshotJson: JSON.stringify(snapshot),
          generatedBy: body.actor || "unknown",
          generatedAt: new Date().toISOString(),
        };
        await ddb.send(new PutCommand({ TableName: T_DOC, Item: rec }));
        await writeAudit(body.actor, "doc.generate", `${seq}/${genId}`, { docType: rec.docType, ref: rec.ref });
        return resp(200, { gen: { docId: genId, docType: rec.docType, title: rec.title, ref: rec.ref } });
      }
      if (parts.length === 4 && method === "GET") {
        const out = await ddb.send(
          new QueryCommand({ TableName: T_DOC, KeyConditionExpression: "employeeSeq = :s", ExpressionAttributeValues: { ":s": seq } }),
        );
        const generated = (out.Items ?? [])
          .filter((d) => d.category === "generated")
          // acceptedAt rides along so the portal can answer "did they accept?"
          // without depending on the notification email having been delivered.
          .map(({ docId, docType, title, ref, generatedBy, generatedAt, acceptedAt }) => ({ docId, docType, title, ref, generatedBy, generatedAt, acceptedAt: acceptedAt ?? null }))
          .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
        return resp(200, { generated });
      }
      if (parts.length === 5 && method === "GET") {
        const g = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        if (!g.Item || g.Item.category !== "generated") return resp(404, { error: "NOT_FOUND" });
        return resp(200, {
          gen: { docId: g.Item.docId, docType: g.Item.docType, title: g.Item.title, ref: g.Item.ref, generatedBy: g.Item.generatedBy, generatedAt: g.Item.generatedAt, snapshot: JSON.parse(g.Item.snapshotJson || "{}") },
        });
      }

      // Acceptance acknowledgment — a candidate-clicked "I accept" timestamp,
      // NOT a legal e-signature. The physical original signed in person is
      // still the real record; this is just a paper trail for "did she see
      // it and say yes" before that. First accept wins (idempotent).
      if (parts.length === 6 && parts[5] === "accept" && method === "GET") {
        const g = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        if (!g.Item || g.Item.category !== "generated" || !ACCEPTABLE_DOCTYPES.has(g.Item.docType)) return resp(404, { error: "NOT_FOUND" });
        return resp(200, {
          docType: g.Item.docType, title: g.Item.title, ref: g.Item.ref,
          acceptedAt: g.Item.acceptedAt || null,
        });
      }
      if (parts.length === 6 && parts[5] === "accept" && method === "POST") {
        const g = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        if (!g.Item || g.Item.category !== "generated" || !ACCEPTABLE_DOCTYPES.has(g.Item.docType)) return resp(404, { error: "NOT_FOUND" });
        if (g.Item.acceptedAt) return resp(200, { ok: true, acceptedAt: g.Item.acceptedAt });

        const acceptedAt = new Date().toISOString();
        const acceptedName = String(body.acceptedName ?? "").trim().slice(0, 120);
        try {
          await ddb.send(
            new UpdateCommand({
              TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] },
              // Conditional write, not merely the read-check above: two clicks
              // arriving together would otherwise both pass that check and the
              // second would overwrite the first. "First accept wins" is the
              // only integrity property this record has, so it is enforced by
              // the database, not by a race-prone read-then-write.
              ConditionExpression: "attribute_not_exists(acceptedAt)",
              UpdateExpression: "SET acceptedAt = :a, acceptedIp = :ip, acceptedName = :n",
              ExpressionAttributeValues: { ":a": acceptedAt, ":ip": body.ip || "", ":n": acceptedName },
            }),
          );
        } catch (e) {
          // Lost the race — someone else's accept landed first. Report theirs;
          // do NOT audit or notify a second time for the same acceptance.
          if (e?.name === "ConditionalCheckFailedException") {
            const again = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
            return resp(200, { ok: true, acceptedAt: again.Item?.acceptedAt ?? acceptedAt });
          }
          throw e;
        }
        await writeAudit("self-serve", "doc.accept", `${seq}/${parts[4]}`, { docType: g.Item.docType, ref: g.Item.ref, acceptedName });
        const empForNotify = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
        if (empForNotify.Item) {
          await notifyAccept(empForNotify.Item, { ...g.Item, docId: parts[4] }, acceptedName);
        }
        return resp(200, { ok: true, acceptedAt });
      }

      // Void an acceptance recorded in error (a test click, the wrong person
      // clicking a forwarded link). Deleting the whole document was previously
      // the only way to undo one, which burnt its reference number. Admin-only
      // at the app layer; the void is audited with the value it erased.
      if (parts.length === 6 && parts[5] === "accept" && method === "DELETE") {
        const g = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        if (!g.Item || g.Item.category !== "generated") return resp(404, { error: "NOT_FOUND" });
        await ddb.send(
          new UpdateCommand({
            TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] },
            UpdateExpression: "REMOVE acceptedAt, acceptedIp, acceptedName",
          }),
        );
        await writeAudit(body.actor, "doc.accept.void", `${seq}/${parts[4]}`, {
          ref: g.Item.ref, voidedAcceptedAt: g.Item.acceptedAt ?? null, voidedAcceptedName: g.Item.acceptedName ?? null,
        });
        return resp(200, { ok: true });
      }

      // Withdraw an issued document — for one genuinely issued in error (wrong
      // month, superseded details). The deletion is audited WITH the ref so the
      // series stays explainable: a gap in SSS/HR numbering must be traceable
      // to a decision, not look like a lost document.
      if (parts.length === 5 && method === "DELETE") {
        const g = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        if (!g.Item || g.Item.category !== "generated") return resp(404, { error: "NOT_FOUND" });
        await ddb.send(new DeleteCommand({ TableName: T_DOC, Key: { employeeSeq: seq, docId: parts[4] } }));
        await writeAudit(body.actor, "doc.delete", `${seq}/${parts[4]}`, { docType: g.Item.docType, ref: g.Item.ref, title: g.Item.title });
        return resp(200, { ok: true });
      }
    }

    // ---- /hr/email (send a document to an employee via Resend) ----
    if (parts[0] === "hr" && parts[1] === "email" && parts.length === 2 && method === "POST") {
      const to = (body.toEmail || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return resp(400, { error: "BAD_EMAIL" });
      const bytes = Buffer.from(body.base64 || "", "base64");
      if (bytes.length === 0 || bytes.length > MAX_BYTES) return resp(400, { error: bytes.length ? "TOO_LARGE" : "EMPTY" });
      if (sniffType(bytes) !== "application/pdf") return resp(400, { error: "PDF_ONLY" });
      const key = process.env.RESEND_API_KEY;
      if (!key) return resp(503, { error: "EMAIL_NOT_CONFIGURED" });

      // Validate the employee BEFORE sending — an archive keyed to a bogus seq
      // would orphan the sent-copy record.
      const seqCheck = Number(body.employeeSeq);
      if (!Number.isInteger(seqCheck) || seqCheck <= 0) return resp(400, { error: "BAD_SEQ" });
      const empCheck = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq: seqCheck } }));
      if (!empCheck.Item) return resp(404, { error: "EMPLOYEE_NOT_FOUND" });

      const recipientName = (empCheck.Item.name || "").split(/\s+/)[0] || "there";
      const subjectLine = body.subject || "Document from ShieldSync HR";

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10000), // don't let a hung Resend call block the Lambda indefinitely
        body: JSON.stringify({
          from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
          to: [to],
          subject: subjectLine,
          text:
            body.bodyText ||
            `Dear ${recipientName},\n\nPlease find your document attached: ${subjectLine}.\n\nIf you have any questions, reply to this email or write to info@shieldsyncsecurity.com.\n\nRegards,\nShieldSync Security Private Limited`,
          html: documentEmailHtml({ recipientName, subjectLine, note: body.note, cta: body.cta }),
          attachments: [{ filename: body.fileName || "document.pdf", content: bytes.toString("base64") }],
        }),
      });
      if (!r.ok) {
        console.error("[hr] Resend send failed", r.status);
        return resp(502, { error: "SEND_FAILED", status: r.status });
      }

      // Archive the exact sent bytes as the issued artifact (category "sent").
      // CRITICAL: the email is ALREADY DELIVERED past this point — an archive
      // failure must return 200 with a warning, never an error the caller
      // would retry (a retry emails the employee a duplicate).
      const seqNum = seqCheck;
      const docId = `s_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const s3key = `emp/${seqNum}/${docId}`;
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET, Key: s3key, Body: bytes, ContentType: "application/pdf",
            ServerSideEncryption: "aws:kms", SSEKMSKeyId: KMS_KEY,
          }),
        );
        await ddb.send(
          new PutCommand({
            TableName: T_DOC,
            Item: {
              employeeSeq: seqNum, docId, category: "sent", kind: "other",
              label: `Emailed to ${to}: ${body.subject || ""}`.trim(),
              fileName: body.fileName || "document.pdf", contentType: "application/pdf",
              sizeBytes: bytes.length, sha256: sha256(bytes), s3Key: s3key,
              uploadedBy: body.actor || "unknown", uploadedAt: new Date().toISOString(),
            },
          }),
        );
      } catch (e) {
        console.error("[hr] email sent but archive failed", e?.name, e?.message);
        try {
          await writeAudit(body.actor, "doc.email", `${seqNum}/-`, { to, subject: body.subject, archived: false });
        } catch {}
        return resp(200, { ok: true, simulated: false, archived: false, warning: "Email SENT, but archiving the copy failed — do not resend; save the PDF to the employee's documents manually." });
      }
      await writeAudit(body.actor, "doc.email", `${seqNum}/${docId}`, { to, subject: body.subject });
      return resp(200, { ok: true, simulated: false, archived: true });
    }

    // ---------------- CANDIDATES (hiring records — NOT employees) ----------------
    // Counter item lives at seq=0, same pattern as employees.
    if (parts[0] === "hr" && parts[1] === "candidates" && parts.length >= 3) {
      const s = Number(parts[2]);
      if (!Number.isInteger(s) || s <= 0) return resp(404, { error: "NOT_FOUND" });
    }

    if (parts[0] === "hr" && parts[1] === "candidates" && parts.length === 2) {
      if (method === "GET") {
        const items = [];
        let startKey;
        do {
          const out = await ddb.send(new ScanCommand({ TableName: T_CAND, ExclusiveStartKey: startKey }));
          items.push(...(out.Items ?? []));
          startKey = out.LastEvaluatedKey;
        } while (startKey);
        return resp(200, { candidates: items.filter((i) => i.seq > 0).sort((a, b) => a.seq - b.seq) });
      }
      if (method === "POST") {
        const c = await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq: 0 },
            UpdateExpression: "ADD #c :one",
            ExpressionAttributeNames: { "#c": "counter" },
            ExpressionAttributeValues: { ":one": 1 },
            ReturnValues: "UPDATED_NEW",
          }),
        );
        const seq = c.Attributes.counter;
        const now = new Date().toISOString();
        const candidate = { ...body.candidate, candidateId: `SSS/CAND/${String(seq).padStart(4, "0")}`, seq, createdAt: now, updatedAt: now };
        await ddb.send(new PutCommand({ TableName: T_CAND, Item: candidate }));
        await writeAudit(body.actor, "candidate.create", candidate.candidateId, { name: candidate.name, role: candidate.roleAppliedFor });
        return resp(200, { candidate });
      }
    }

    if (parts[0] === "hr" && parts[1] === "candidates" && parts.length >= 3) {
      const seq = Number(parts[2]);
      const cur = (await ddb.send(new GetCommand({ TableName: T_CAND, Key: { seq } }))).Item;
      if (!cur) return resp(404, { error: "NOT_FOUND" });

      if (parts.length === 3 && method === "GET") return resp(200, { candidate: cur });

      if (parts.length === 3 && method === "PUT") {
        // Token + submission state are engine-owned — a form PUT can't forge them.
        const candidate = {
          ...cur,
          ...body.candidate,
          seq,
          candidateId: cur.candidateId,
          tokenHash: cur.tokenHash,
          tokenIssuedAt: cur.tokenIssuedAt,
          tokenExpiresAt: cur.tokenExpiresAt,
          questionnaireSentTo: cur.questionnaireSentTo,
          questionnaireSentAt: cur.questionnaireSentAt,
          submittedAt: cur.submittedAt,
          answers: cur.answers,
          // Open tracking is engine-owned too — editing a candidate's details
          // must not silently reset the evidence of whether they opened the link.
          firstViewedAt: cur.firstViewedAt,
          lastViewedAt: cur.lastViewedAt,
          viewCount: cur.viewCount,
          createdAt: cur.createdAt,
          updatedAt: new Date().toISOString(),
        };
        await ddb.send(new PutCommand({ TableName: T_CAND, Item: candidate }));
        await writeAudit(body.actor, "candidate.update", candidate.candidateId, { outcome: candidate.outcome });
        return resp(200, { candidate });
      }

      if (parts.length === 3 && method === "DELETE") {
        // Erasure must destroy the uploaded proof too — ALL versions, same as
        // the KYC vault. The questionnaire promises deletion on request.
        if (cur.salaryProof) await purgeAllVersions(`cand/${seq}/${cur.salaryProof.docId}`);
        await ddb.send(new DeleteCommand({ TableName: T_CAND, Key: { seq } }));
        await writeAudit(body.actor, "candidate.delete", cur.candidateId, { name: cur.name, removedProof: Boolean(cur.salaryProof) });
        return resp(200, { ok: true });
      }

      // ---- /hr/candidates/:seq/proof — HR-side download ----
      if (parts[3] === "proof" && parts.length === 4 && method === "GET") {
        if (!cur.salaryProof) return resp(404, { error: "NOT_FOUND" });
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `cand/${seq}/${cur.salaryProof.docId}` }));
        const bytes = Buffer.from(await obj.Body.transformToByteArray());
        await writeAudit(qs.actor, "candidate.proof.download", cur.candidateId, { fileName: cur.salaryProof.fileName });
        return resp(200, { ...cur.salaryProof, base64: bytes.toString("base64") });
      }

      // ---- /hr/candidates/:seq/token — issue (or re-issue) the link ----
      if (parts[3] === "token" && parts.length === 4 && method === "POST") {
        const secret = randomBytes(24).toString("hex"); // 192-bit
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (Number(body.validDays) || 14) * 86400000).toISOString();
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression: "SET tokenHash = :h, tokenIssuedAt = :i, tokenExpiresAt = :e, updatedAt = :u",
            ExpressionAttributeValues: {
              ":h": sha256(Buffer.from(secret)),
              ":i": now.toISOString(),
              ":e": expiresAt,
              ":u": now.toISOString(),
            },
          }),
        );
        await writeAudit(body.actor, "candidate.link", cur.candidateId, { expiresAt });
        // Raw token returned exactly once; only its hash is ever stored.
        return resp(200, { token: `${seq}.${secret}`, expiresAt });
      }

      // ---- /hr/candidates/:seq/token DELETE — kill a link already sent ----
      // REMOVE the hash rather than back-dating the expiry: an expired link and
      // a revoked one must be indistinguishable to whoever holds it, and an
      // absent hash cannot be matched by any token at all. Answers must survive,
      // so only the link dies — not what they already told us.
      if (parts[3] === "token" && parts.length === 4 && method === "DELETE") {
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression: "REMOVE tokenHash, tokenIssuedAt, tokenExpiresAt SET updatedAt = :u",
            ExpressionAttributeValues: { ":u": new Date().toISOString() },
          }),
        );
        await writeAudit(body.actor, "candidate.link.revoke", cur.candidateId, {
          hadSubmitted: Boolean(cur.submittedAt),
          sentTo: cur.questionnaireSentTo ?? null,
        });
        return resp(200, { ok: true });
      }

      // ---- /hr/candidates/:seq/interviews — scheduled rounds ----
      // Its own endpoint rather than a field on the candidate PUT: a scheduled
      // meeting has a real calendar event behind it, so a stale form post must
      // not be able to silently drop one.
      if (parts[3] === "interviews" && parts.length === 4 && method === "POST") {
        const iv = {
          id: `iv_${Date.now()}_${randomUUID().slice(0, 8)}`,
          createdAt: new Date().toISOString(),
          createdBy: body.actor || "unknown",
          ...body.interview,
        };
        const list = [...(cur.interviews ?? []), iv].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression: "SET interviews = :i, updatedAt = :u",
            ExpressionAttributeValues: { ":i": list, ":u": new Date().toISOString() },
          }),
        );
        await writeAudit(body.actor, "interview.schedule", cur.candidateId, {
          startsAt: iv.startsAt,
          invited: Boolean(iv.invitedAt),
          hasMeeting: Boolean(iv.meetingUrl),
        });
        return resp(200, { interview: iv, interviews: list });
      }

      if (parts[3] === "interviews" && parts.length === 5 && method === "DELETE") {
        const list = (cur.interviews ?? []).filter((x) => x.id !== parts[4]);
        const gone = (cur.interviews ?? []).find((x) => x.id === parts[4]);
        if (!gone) return resp(404, { error: "NOT_FOUND" });
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression: "SET interviews = :i, updatedAt = :u",
            ExpressionAttributeValues: { ":i": list, ":u": new Date().toISOString() },
          }),
        );
        await writeAudit(body.actor, "interview.cancel", cur.candidateId, { startsAt: gone.startsAt });
        return resp(200, { interviews: list });
      }

      if (parts[3] === "sent" && parts.length === 4 && method === "POST") {
        const now = new Date().toISOString();
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression: "SET questionnaireSentTo = :t, questionnaireSentAt = :a, updatedAt = :a",
            ExpressionAttributeValues: { ":t": body.to ?? "", ":a": now },
          }),
        );
        return resp(200, { ok: true });
      }
    }

    // ---- /hr/questionnaire/:token — PUBLIC candidate surface ----
    if (parts[0] === "hr" && parts[1] === "questionnaire" && (parts.length === 3 || parts.length === 4)) {
      const raw = decodeURIComponent(parts[2]);
      const dot = raw.indexOf(".");
      const seq = Number(raw.slice(0, dot));
      const secret = raw.slice(dot + 1);
      if (!Number.isInteger(seq) || seq <= 0 || !secret) return resp(404, { error: "BAD_TOKEN" });
      const cand = (await ddb.send(new GetCommand({ TableName: T_CAND, Key: { seq } }))).Item;
      if (!cand?.tokenHash) return resp(404, { error: "BAD_TOKEN" });
      const a = Buffer.from(cand.tokenHash, "hex");
      const b = Buffer.from(sha256(Buffer.from(secret)), "hex");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return resp(404, { error: "BAD_TOKEN" });
      if (cand.tokenExpiresAt && new Date(cand.tokenExpiresAt) < new Date()) return resp(410, { error: "EXPIRED" });

      const publicView = (c) => ({
        name: c.name,
        roleAppliedFor: c.roleAppliedFor,
        questionnaireRole: c.questionnaireRole,
        submittedAt: c.submittedAt,
        answers: c.submittedAt ? c.answers : undefined,
        // Filename only — so the form can show "uploaded ✓" if they come back.
        salaryProofName: c.salaryProof?.fileName,
        expiresAt: c.tokenExpiresAt,
        // If the HR user tailored the questionnaire for this candidate, the
        // public page uses that snapshot instead of loading the default.
        customQuestionnaire: c.customQuestionnaire,
      });

      if (method === "GET") {
        // ?preview=1 means an authenticated HR user is checking their own link.
        // Counting that as a candidate open is what made "has she opened it?"
        // impossible to answer — the owner's own 4-seconds-after-sending click
        // looked identical to the candidate arriving.
        if (qs.preview === "1") {
          await writeAudit("hr-preview", "questionnaire.preview", cand.candidateId, {});
          return resp(200, { candidate: publicView(cand) });
        }
        // A real candidate open. First and last are kept separately: "when did
        // she start looking" and "was she back an hour ago" answer different
        // questions. No IP, no device — just that it happened.
        const now = new Date().toISOString();
        await ddb.send(
          new UpdateCommand({
            TableName: T_CAND,
            Key: { seq },
            UpdateExpression:
              "SET firstViewedAt = if_not_exists(firstViewedAt, :n), lastViewedAt = :n, viewCount = if_not_exists(viewCount, :z) + :one",
            ExpressionAttributeValues: { ":n": now, ":z": 0, ":one": 1 },
          }),
        );
        await writeAudit("candidate", "questionnaire.view", cand.candidateId, {});
        return resp(200, { candidate: publicView(cand) });
      }
      // ---- /hr/questionnaire/:token/upload — candidate's salary proof ----
      // Public surface, so the same defences as the KYC vault: magic-byte
      // sniffing, hard size cap, one file per candidate, closed after submit.
      if (parts.length === 4 && parts[3] === "upload") {
        if (cand.submittedAt) return resp(409, { error: "ALREADY_SUBMITTED" });
        const key = (docId) => `cand/${seq}/${docId}`;

        if (method === "POST") {
          const bytes = Buffer.from(body.base64 || "", "base64");
          if (bytes.length === 0) return resp(400, { error: "EMPTY" });
          if (bytes.length > MAX_BYTES) return resp(400, { error: "TOO_LARGE" });
          const sniffed = sniffType(bytes);
          if (!sniffed) return resp(400, { error: "BAD_TYPE" });

          if (cand.salaryProof) await purgeAllVersions(key(cand.salaryProof.docId)); // replace
          const docId = `cand_${seq}_${Date.now()}_${randomUUID().slice(0, 8)}`;
          await s3.send(
            new PutObjectCommand({
              Bucket: BUCKET,
              Key: key(docId),
              Body: bytes,
              ContentType: sniffed,
              ServerSideEncryption: "aws:kms",
              SSEKMSKeyId: KMS_KEY,
            }),
          );
          const salaryProof = {
            docId,
            fileName: String(body.fileName || "document").slice(0, 120),
            contentType: sniffed,
            sizeBytes: bytes.length,
            sha256: sha256(bytes),
            uploadedAt: new Date().toISOString(),
          };
          await ddb.send(
            new UpdateCommand({
              TableName: T_CAND,
              Key: { seq },
              UpdateExpression: "SET salaryProof = :p, updatedAt = :u",
              ExpressionAttributeValues: { ":p": salaryProof, ":u": salaryProof.uploadedAt },
            }),
          );
          await writeAudit("candidate", "questionnaire.upload", cand.candidateId, { fileName: salaryProof.fileName, bytes: bytes.length });
          return resp(200, { salaryProofName: salaryProof.fileName });
        }

        if (method === "DELETE") {
          if (cand.salaryProof) {
            await purgeAllVersions(key(cand.salaryProof.docId));
            await ddb.send(
              new UpdateCommand({
                TableName: T_CAND,
                Key: { seq },
                UpdateExpression: "REMOVE salaryProof SET updatedAt = :u",
                ExpressionAttributeValues: { ":u": new Date().toISOString() },
              }),
            );
            await writeAudit("candidate", "questionnaire.upload.remove", cand.candidateId, {});
          }
          return resp(200, { ok: true });
        }
      }

      if (method === "POST") {
        if (cand.submittedAt) return resp(409, { error: "ALREADY_SUBMITTED" });
        const now = new Date().toISOString();
        const answers = body.answers ?? {};
        let out;
        try {
          out = await ddb.send(
            new UpdateCommand({
              TableName: T_CAND,
              Key: { seq },
              // attribute_not_exists is the real single-submit guard: two
              // concurrent posts can both pass the read above.
              ConditionExpression: "attribute_not_exists(submittedAt)",
              UpdateExpression: "SET answers = :a, submittedAt = :s, updatedAt = :s",
              ExpressionAttributeValues: { ":a": answers, ":s": now },
              ReturnValues: "ALL_NEW",
            }),
          );
        } catch (e) {
          if (e.name === "ConditionalCheckFailedException") return resp(409, { error: "ALREADY_SUBMITTED" });
          throw e;
        }
        await writeAudit("candidate", "questionnaire.submit", cand.candidateId, { fields: Object.keys(answers).length });
        // Tell the owner, with the answers in the mail. A submission the owner
        // has to remember to go and look for is one that sits unread for days;
        // the whole point of the questionnaire is to act on it while the
        // interview is still fresh.
        await notifySubmission(out.Attributes, answers);
        return resp(200, { candidate: publicView(out.Attributes) });
      }
    }

    // ---- /hr/notify — plain HTML email (no attachment) ----
    if (parts[0] === "hr" && parts[1] === "notify" && parts.length === 2 && method === "POST") {
      const to = (body.toEmail || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return resp(400, { error: "BAD_EMAIL" });
      const key = process.env.RESEND_API_KEY;
      if (!key) return resp(503, { error: "EMAIL_NOT_CONFIGURED" });
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10000), // don't let a hung Resend call block the Lambda indefinitely
        body: JSON.stringify({
          from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
          to: [to],
          subject: body.subject || "ShieldSync Security",
          html: body.html,
          text: body.text,
        }),
      });
      if (!r.ok) return resp(502, { error: "SEND_FAILED", status: r.status });
      await writeAudit(body.actor, body.action || "candidate.email", body.target || "", { to, subject: body.subject });
      return resp(200, { ok: true, simulated: false });
    }

    // ---- /hr/tax/summary — aggregate TDS from all issued payslips ----
    // Scans T_DOC for payslip documents and groups their TDS deductions by
    // salary month so the /tax calendar can show what's been deducted vs paid.
    if (parts[0] === "hr" && parts[1] === "tax" && parts[2] === "summary" && parts.length === 3 && method === "GET") {
      const items = [];
      let startKey;
      do {
        const out = await ddb.send(new ScanCommand({
          TableName: T_DOC,
          FilterExpression: "docType = :pt",
          ExpressionAttributeValues: { ":pt": "payslip" },
          ExclusiveStartKey: startKey,
        }));
        items.push(...(out.Items ?? []));
        startKey = out.LastEvaluatedKey;
      } while (startKey);

      const byMonth = {};
      for (const item of items) {
        if (!item.snapshotJson) continue;
        let snap;
        try { snap = JSON.parse(item.snapshotJson); } catch { continue; }
        // Prefer snap.month; fall back to last 7 chars of the ref (YYYY-MM suffix).
        const month = snap.month ?? (typeof item.ref === "string" ? item.ref.slice(-7) : null);
        if (!month || !/^\d{4}-\d{2}$/.test(month)) continue;
        const tds = Number(snap.deductions?.tds) || 0;
        const pf  = Number(snap.deductions?.pf)  || 0;
        const esi = Number(snap.deductions?.esi) || 0;
        const net = Number(snap.netPay) || 0;
        if (!byMonth[month]) byMonth[month] = { tds: 0, pf: 0, esi: 0, netPay: 0, payslipCount: 0 };
        byMonth[month].tds  += tds;
        byMonth[month].pf   += pf;
        byMonth[month].esi  += esi;
        byMonth[month].netPay += net;
        byMonth[month].payslipCount += 1;
      }
      return resp(200, { byMonth });
    }

    // ---------------- INVOICES (company-issued B2B invoices) ----------------
    // Stored in T_DOC under the special partition employeeSeq = -30 so no
    // new DynamoDB table is needed. Each invoice is one item with docType="invoice".
    const INV_SEQ = -30;

    if (parts[0] === "hr" && parts[1] === "invoices") {
      // GET /hr/invoices — list all invoices
      if (method === "GET" && parts.length === 2) {
        const out = await ddb.send(new QueryCommand({
          TableName: T_DOC,
          KeyConditionExpression: "employeeSeq = :s",
          ExpressionAttributeValues: { ":s": INV_SEQ },
        }));
        const invoices = (out.Items ?? [])
          .filter(i => i.docType === "invoice")
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
        return resp(200, { invoices });
      }

      // GET /hr/invoices/:id — get one
      if (method === "GET" && parts.length === 3) {
        const inv = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: INV_SEQ, docId: parts[2] } }));
        if (!inv.Item) return resp(404, { error: "NOT_FOUND" });
        return resp(200, { invoice: inv.Item });
      }

      // POST /hr/invoices — create
      if (method === "POST" && parts.length === 2) {
        // `body` is already the parsed request body (line 433) -- `req` doesn't
        // exist in this scope. This shadowing threw a ReferenceError on every
        // call, so invoice creation was completely broken (a 500 on every POST).
        if (!body.clientName || !body.description || !body.amount) return resp(400, { error: "MISSING_FIELDS" });
        // Auto-number: count existing invoices for this month
        const ym = (body.issueDate ?? new Date().toISOString().slice(0, 7)).slice(0, 7);
        const existing = await ddb.send(new QueryCommand({
          TableName: T_DOC,
          KeyConditionExpression: "employeeSeq = :s",
          ExpressionAttributeValues: { ":s": INV_SEQ },
        }));
        const monthCount = (existing.Items ?? []).filter(i => i.docType === "invoice" && (i.issueDate ?? "").startsWith(ym)).length;
        const seq = String(monthCount + 1).padStart(3, "0");
        const ymShort = ym.replace("-", "-");
        const invId = `INV-${ymShort}-${seq}`;
        const now = new Date().toISOString();
        const item = {
          employeeSeq: INV_SEQ,
          docId: invId,
          docType: "invoice",
          invId,
          clientName: body.clientName,
          clientEmail: body.clientEmail ?? "",
          clientGstin: body.clientGstin ?? "",
          clientAddress: body.clientAddress ?? "",
          description: body.description,
          lineItems: body.lineItems ?? [],
          amount: Number(body.amount),
          gstRate: Number(body.gstRate ?? 0),
          gstAmount: Number(body.gstAmount ?? 0),
          totalAmount: Number(body.totalAmount ?? body.amount),
          currency: "INR",
          issueDate: body.issueDate ?? now.slice(0, 10),
          dueDate: body.dueDate ?? "",
          status: body.status ?? "draft",
          notes: body.notes ?? "",
          createdAt: now,
          updatedAt: now,
        };
        await ddb.send(new PutCommand({ TableName: T_DOC, Item: item }));
        await writeAudit(body.actor ?? "system", "invoice.create", invId, { clientName: body.clientName, amount: item.totalAmount });
        return resp(201, { invoice: item });
      }

      // PUT /hr/invoices/:id — update
      if (method === "PUT" && parts.length === 3) {
        const invId = parts[2];
        const existing = await ddb.send(new GetCommand({ TableName: T_DOC, Key: { employeeSeq: INV_SEQ, docId: invId } }));
        if (!existing.Item) return resp(404, { error: "NOT_FOUND" });
        // Same fix as POST above -- `body` is already parsed, `req` doesn't exist.
        const updated = { ...existing.Item, ...body, employeeSeq: INV_SEQ, docId: invId, docType: "invoice", updatedAt: new Date().toISOString() };
        // Reverting away from "paid" must clear the payment stamp — inferStatus()
        // treats any invoice with a paidDate as paid, so a stale paidDate makes the
        // revert a no-op. PutCommand replaces the whole item, so deleting the keys
        // removes them from the stored record (a shallow merge would leave them).
        if (updated.status !== "paid") {
          delete updated.paidDate;
          delete updated.paidAmount;
        }
        await ddb.send(new PutCommand({ TableName: T_DOC, Item: updated }));
        await writeAudit(body.actor ?? "system", "invoice.update", invId, { status: updated.status });
        return resp(200, { invoice: updated });
      }

      // DELETE /hr/invoices/:id — delete
      if (method === "DELETE" && parts.length === 3) {
        const invId = parts[2];
        await ddb.send(new DeleteCommand({ TableName: T_DOC, Key: { employeeSeq: INV_SEQ, docId: invId } }));
        await writeAudit("system", "invoice.delete", invId, {});
        return resp(200, { ok: true });
      }
    }

    // ---------------- BANKING (imported bank statement transactions) ----------------
    if (parts[0] === "hr" && parts[1] === "banking" && parts.length === 2) {
      if (method === "GET") {
        const items = [];
        let startKey;
        do {
          const out = await ddb.send(new ScanCommand({ TableName: T_BANK, ExclusiveStartKey: startKey }));
          items.push(...(out.Items ?? []));
          startKey = out.LastEvaluatedKey;
        } while (startKey);
        const month = qs.month;
        const filtered = month ? items.filter((t) => t.month === month) : items;
        // Newest first, and stable within a day via the running balance.
        filtered.sort((a, b) => (a.date === b.date ? b.balance - a.balance : a.date < b.date ? 1 : -1));
        return resp(200, { transactions: filtered });
      }

      // Bulk import. The txnId is a deterministic hash of the statement row, so
      // re-importing an overlapping period overwrites rather than duplicates —
      // double-counted money would be far worse than a rejected import.
      if (method === "POST") {
        const txns = Array.isArray(body.transactions) ? body.transactions : [];
        if (!txns.length) return resp(400, { error: "NO_TRANSACTIONS" });
        if (txns.length > 2000) return resp(400, { error: "TOO_MANY" });

        const now = new Date().toISOString();
        let created = 0;
        let updated = 0;
        for (const t of txns) {
          if (!t?.txnId || !t?.date) continue;
          const existing = (await ddb.send(new GetCommand({ TableName: T_BANK, Key: { txnId: t.txnId } }))).Item;
          if (existing) {
            // Preserve any manual classification the user has already applied.
            await ddb.send(
              new PutCommand({
                TableName: T_BANK,
                Item: {
                  ...t,
                  category: existing.categorySetBy === "user" ? existing.category : t.category,
                  categorySetBy: existing.categorySetBy,
                  note: existing.note ?? t.note,
                  importedAt: existing.importedAt ?? now,
                  importedBy: existing.importedBy ?? body.actor,
                  updatedAt: now,
                },
              }),
            );
            updated += 1;
          } else {
            await ddb.send(new PutCommand({ TableName: T_BANK, Item: { ...t, importedAt: now, importedBy: body.actor, updatedAt: now } }));
            created += 1;
          }
        }
        await writeAudit(body.actor, "banking.import", body.accountNumber ?? "", { created, updated, total: txns.length });
        return resp(200, { ok: true, created, updated });
      }
    }

    // ---- /hr/banking/:txnId — reclassify or annotate a single transaction ----
    if (parts[0] === "hr" && parts[1] === "banking" && parts.length === 3) {
      const txnId = decodeURIComponent(parts[2]);
      const cur = (await ddb.send(new GetCommand({ TableName: T_BANK, Key: { txnId } }))).Item;
      if (!cur) return resp(404, { error: "NOT_FOUND" });

      if (method === "PUT") {
        const item = {
          ...cur,
          category: body.category ?? cur.category,
          note: body.note !== undefined ? body.note : cur.note,
          matchedEmployeeSeq: body.matchedEmployeeSeq !== undefined ? body.matchedEmployeeSeq : cur.matchedEmployeeSeq,
          // Marks this row as human-classified so a re-import won't revert it.
          categorySetBy: body.category ? "user" : cur.categorySetBy,
          updatedAt: new Date().toISOString(),
        };
        await ddb.send(new PutCommand({ TableName: T_BANK, Item: item }));
        await writeAudit(body.actor, "banking.update", txnId, { category: item.category });
        return resp(200, { transaction: item });
      }
      if (method === "DELETE") {
        await ddb.send(new DeleteCommand({ TableName: T_BANK, Key: { txnId } }));
        await writeAudit(body.actor, "banking.delete", txnId, {});
        return resp(200, { ok: true });
      }
    }

    // ---- /hr/access (per-user permissions) ----
    //
    // Stored as ONE item so a read is a single GetCommand on every request and
    // a write is atomic across all users. Key seq = -1 in the employees table:
    // negative seqs are already the reserved counter space, and the reference
    // counters occupy -(year*10 + series) — always <= -20250 for any plausible
    // year — so -1 can never collide with one.
    //
    // ADMINS ARE NOT STORED HERE. Admin identity lives in the app's
    // HR_ADMIN_EMAILS env var, so nothing written through this route can grant
    // or revoke administrator rights.
    if (parts[0] === "hr" && parts[1] === "access" && parts.length === 2) {
      const KEY = { seq: -1 };
      if (method === "GET") {
        const cur = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: KEY }))).Item;
        return resp(200, { grants: cur?.grants ?? {}, restrictedSeqs: cur?.restrictedSeqs ?? [] });
      }
      if (method === "PUT") {
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email) return resp(400, { error: "EMAIL_REQUIRED" });
        const cur = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: KEY }))).Item;
        const grants = { ...(cur?.grants ?? {}) };
        if (body.access === null) delete grants[email];
        else grants[email] = body.access;
        // UpdateCommand on ONLY the grants attribute — a whole-item PutCommand
        // (the old approach) would silently clobber a concurrent /hr/settings
        // or /hr/restricted write to this same seq:-1 config item, since all
        // three read-modify-write the same row. Updating a single top-level
        // attribute is what DynamoDB actually guarantees atomically; two
        // concurrent writes to DIFFERENT attributes on the same item never
        // race each other this way.
        await ddb.send(new UpdateCommand({
          TableName: T_EMP, Key: KEY,
          UpdateExpression: "SET grants = :g, updatedAt = :u",
          ExpressionAttributeValues: { ":g": grants, ":u": new Date().toISOString() },
        }));
        // Audited with the full resulting permission set: "who could see what,
        // when" has to be reconstructable from the log alone.
        await writeAudit(body.actor, "access.update", email, { access: body.access ?? null });
        return resp(200, { grants });
      }
    }

    // ---- /hr/settings (in-app config: GST registration, GSTIN, default rate) ----
    // Stored on the SAME seq:-1 config singleton as grants/restrictedSeqs.
    // Written via UpdateCommand on ONLY the settings attribute — see the
    // /hr/access comment above for why (concurrent writes to different
    // attributes on the same item must never clobber each other).
    if (parts[0] === "hr" && parts[1] === "settings" && parts.length === 2) {
      const KEY = { seq: -1 };
      if (method === "GET") {
        const cur = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: KEY }))).Item;
        return resp(200, { settings: cur?.settings ?? {} });
      }
      if (method === "PUT") {
        const cur = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: KEY }))).Item;
        const settings = { ...(cur?.settings ?? {}), ...(body.settings ?? {}) };
        await ddb.send(new UpdateCommand({
          TableName: T_EMP, Key: KEY,
          UpdateExpression: "SET settings = :s, updatedAt = :u",
          ExpressionAttributeValues: { ":s": settings, ":u": new Date().toISOString() },
        }));
        await writeAudit(body.actor, "settings.update", "gst", { settings: body.settings ?? {} });
        return resp(200, { settings });
      }
    }

    // ---- /hr/restricted (records visible to the administrator only) ----
    // A restricted employee record disappears for every non-admin viewer:
    // the app's middleware blocks /employees/:seq and /api/employees/:seq/*
    // outright, and the list page drops the row. Admin views are unaffected.
    if (parts[0] === "hr" && parts[1] === "restricted" && parts.length === 2 && method === "PUT") {
      const seqN = Number(body.seq);
      if (!Number.isInteger(seqN) || seqN <= 0) return resp(400, { error: "BAD_SEQ" });
      const KEY = { seq: -1 };
      const cur = (await ddb.send(new GetCommand({ TableName: T_EMP, Key: KEY }))).Item;
      const set = new Set(cur?.restrictedSeqs ?? []);
      if (body.restricted) set.add(seqN);
      else set.delete(seqN);
      // Single-attribute UpdateCommand — see the /hr/access comment above.
      await ddb.send(new UpdateCommand({
        TableName: T_EMP, Key: KEY,
        UpdateExpression: "SET restrictedSeqs = :r, updatedAt = :u",
        ExpressionAttributeValues: { ":r": [...set], ":u": new Date().toISOString() },
      }));
      await writeAudit(body.actor, "employee.visibility", String(seqN), { restricted: !!body.restricted });
      return resp(200, { restrictedSeqs: [...set] });
    }

    // ---- /hr/audit ----
    if (parts[0] === "hr" && parts[1] === "audit" && parts.length === 2) {
      if (method === "GET") {
        const limit = Math.min(Math.max(Number(qs.limit) || 50, 1), 500);
        // Paginate the Scan fully: a single page returns ~1 MB in ARBITRARY key
        // order, so without the loop the "latest N" silently drops the newest
        // events once the table outgrows one page.
        const items = [];
        let startKey;
        do {
          const out = await ddb.send(new ScanCommand({ TableName: T_AUDIT, ExclusiveStartKey: startKey }));
          items.push(...(out.Items ?? []));
          startKey = out.LastEvaluatedKey;
        } while (startKey);
        const audit = items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
        return resp(200, { audit });
      }
      if (method === "POST") {
        await writeAudit(body.actor, body.action ?? "note", body.target, body.detail);
        return resp(200, { ok: true });
      }
    }

    return resp(404, { error: "NO_ROUTE", path: rawPath });
  } catch (e) {
    console.error("[hr-handler]", e?.name, e?.message);
    return resp(500, { error: "SERVER", name: e?.name });
  }
}
