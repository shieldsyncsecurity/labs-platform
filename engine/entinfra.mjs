// ShieldSync ENTERPRISE (B2B) — EntInfra: DynamoDB data-access layer.
//
// Backs enterprise.shieldsyncsecurity.com (the hiring-assessment product). Talks to
// the 6 ShieldSyncEnt* tables ONLY (schema authored in create-ent-tables.mjs) — this
// module never reads/writes any ShieldSyncLab* row and never imports labinfra.mjs.
// Same AWS SDK v3 + credential-bridge conventions as labinfra.mjs (local dev chains
// through STS into the platform account; in Lambda the execution role is used
// directly) so the two engines can eventually share a deploy story.
//
// Uses the low-level @aws-sdk/client-dynamodb (raw AttributeValue marshalling) to
// match labinfra.mjs's client setup exactly — @aws-sdk/lib-dynamodb (Document
// client) is NOT a project dependency, so TransactWriteItemsCommand + friends are
// used directly instead of the Document-client TransactWriteCommand wrapper the task
// spec suggested. Behaviour is identical; only the marshalling style differs.

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";

const ORGS_TABLE = "ShieldSyncEntOrgs";
const ASSESSMENTS_TABLE = "ShieldSyncEntAssessments";
const INVITES_TABLE = "ShieldSyncEntInvites";
const SLOTS_TABLE = "ShieldSyncEntSlots";
const RESULTS_TABLE = "ShieldSyncEntResults";
const ORDERS_TABLE = "ShieldSyncEntOrders";
const AGREEMENTS_TABLE = "ShieldSyncEntAgreements";
const AUDIT_TABLE = "ShieldSyncEntAudit";

// Epoch-seconds helpers for ttl / rolling windows.
const DAYS = 24 * 3600;
const MONTHS = 30 * DAYS; // approximate calendar month, good enough for retention windows

/** now(): current time in epoch SECONDS — DynamoDB TTL requires seconds (not ms). */
function now() {
  return Math.floor(Date.now() / 1000);
}

/** nowIso(): current time as an ISO string, for human-readable timestamps
 *  (createdAt/paidAt/etc) — mirrors labinfra.mjs's use of ISO strings for those. */
function nowIso() {
  return new Date().toISOString();
}

// --- credential bridge (local dev only) — identical shape to labinfra.mjs's ---
let _pc;
async function platformCreds() {
  if (_pc && _pc.exp > Date.now() + 60000) return _pc.creds;
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "engine-local",
    })
  );
  const c = r.Credentials;
  _pc = {
    creds: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
    exp: new Date(c.Expiration).getTime(),
  };
  return _pc.creds;
}

/** platformCredentials(): the same local-dev STS bridge as this module's own
 *  DynamoDB client, exported so ent-handler's docs S3 client can reach the
 *  platform account's bucket when running OUTSIDE Lambda (local dev/tests).
 *  In Lambda, callers must NOT use this -- the execution role is the identity. */
export async function platformCredentials() {
  return platformCreds();
}

let _ddb;
async function ddb() {
  if (_ddb) return _ddb;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Lambda: execution role provides credentials directly — no STS bridge needed.
    _ddb = new DynamoDBClient({ region: REGION });
  } else {
    // Local dev: pass platformCreds as a live provider so the SDK re-evaluates on
    // each call — the cache + refresh above means it only hits STS near expiry.
    _ddb = new DynamoDBClient({ region: REGION, credentials: platformCreds });
  }
  return _ddb;
}

// ── TOKENS / CRYPTO ──────────────────────────────────────────────────────────

/** newToken(): a CSPRNG hex token. 16 bytes (default) = 128-bit — used for every
 *  entity id/token in this module (orgId, assessmentId, inviteToken, reportToken,
 *  candidateReportToken, orderId, slotKey when caller wants one, etc). */
export function newToken(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

// Shared secret for OTP hashing. Falls back to a dev constant when unset, mirroring
// labinfra.mjs's hashIp pattern — never rely on the fallback in production (set
// ENT_ENGINE_SECRET in the Lambda env).
function otpSecret() {
  return process.env.ENT_ENGINE_SECRET || "shieldsync-ent-dev";
}

/** hashOtp(): HMAC-SHA256 of the OTP code, keyed by ENT_ENGINE_SECRET. The raw code
 *  is NEVER stored — only this hash. Domain-separated with an "otp:" prefix so the
 *  same secret can't be replayed against a different HMAC use elsewhere. */
export function hashOtp(code) {
  return createHmac("sha256", otpSecret()).update("otp:" + String(code)).digest("hex");
}

// ── low-level marshalling helpers (this module uses @aws-sdk/client-dynamodb
// directly, not the lib-dynamodb Document client — see file header) ────────────

const S = (v) => ({ S: String(v) });
const N = (v) => ({ N: String(v) });
const BOOL = (v) => ({ BOOL: !!v });
const SS_or_undef = (v) => (Array.isArray(v) && v.length ? { L: v.map((x) => ({ S: String(x) })) } : { L: [] });

function unwrap(v) {
  if (v === undefined) return undefined;
  if ("S" in v) return v.S;
  if ("N" in v) return Number(v.N);
  if ("BOOL" in v) return v.BOOL;
  if ("L" in v) return v.L.map(unwrap);
  if ("M" in v) return Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, unwrap(x)]));
  return undefined;
}

/** itemToObject(): turn a raw DynamoDB Item (AttributeValue map) into a plain JS
 *  object. Returns null for a missing item so callers can `if (!x) return null`. */
function itemToObject(item) {
  if (!item) return null;
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unwrap(v)]));
}

// ── ORGS ─────────────────────────────────────────────────────────────────────

/**
 * createOrg(): register a new buyer org with its starting credit grant and the
 * click-through agreement it accepted. creditsUsed always starts at 0 — credits
 * are only ever consumed via createInvite's transaction, never set directly here.
 */
export async function createOrg({ name, adminEmails, creditsTotal, gstin, billingAddress, agreementVersion }) {
  const db = await ddb();
  const orgId = newToken();
  const createdAt = nowIso();
  const item = {
    orgId: S(orgId),
    name: S(name ?? ""),
    adminEmails: SS_or_undef(adminEmails),
    creditsTotal: N(creditsTotal ?? 0),
    creditsUsed: N(0),
    gstin: S(gstin ?? ""),
    billingAddress: S(billingAddress ?? ""),
    acceptedAgreementVersion: S(agreementVersion ?? ""),
    acceptedAt: S(createdAt),
    status: S("active"),
    createdAt: S(createdAt),
  };
  await db.send(new PutItemCommand({ TableName: ORGS_TABLE, Item: item }));
  return itemToObject(item);
}

/** getOrg(): fetch one org by id, or null. */
export async function getOrg(orgId) {
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: ORGS_TABLE, Key: { orgId: S(orgId) } }));
  return itemToObject(r.Item);
}

/**
 * deleteOrg(): hard-delete an org row by id. The CALLER (handler) MUST have
 * already confirmed the org has NO assessments, so this can never orphan
 * candidate PII / results. Used for removing mistaken or test orgs.
 */
export async function deleteOrg(orgId) {
  const db = await ddb();
  await db.send(new DeleteItemCommand({ TableName: ORGS_TABLE, Key: { orgId: S(orgId) } }));
}

/**
 * addCredits(): top up an org's credit balance by `delta` (positive integer).
 * Plain ADD on creditsTotal — no condition needed since a top-up can never make
 * the ledger inconsistent (creditsUsed is untouched). Also clears the low-credit
 * notification stamp (E5): a top-up re-arms the >=80%-usage alert so the NEXT
 * threshold-cross emails ops again. Returns the updated org.
 */
export async function addCredits(orgId, delta) {
  const db = await ddb();
  const r = await db.send(
    new UpdateItemCommand({
      TableName: ORGS_TABLE,
      Key: { orgId: S(orgId) },
      UpdateExpression: "ADD creditsTotal :d REMOVE lowCreditNotifiedAt",
      ExpressionAttributeValues: { ":d": N(delta) },
      ReturnValues: "ALL_NEW",
    })
  );
  return itemToObject(r.Attributes);
}

/**
 * stampLowCreditNotified(): claim the right to send the ONE low-credit ops email
 * for the current threshold-cross (E5). Conditional on the stamp being absent so
 * concurrent invite charges racing past 80% produce exactly one winner -- only the
 * caller that gets true sends the email. The stamp is cleared whenever credits
 * are added (addCredits / markOrderPaid), re-arming the alert.
 */
export async function stampLowCreditNotified(orgId) {
  const db = await ddb();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: ORGS_TABLE,
        Key: { orgId: S(orgId) },
        UpdateExpression: "SET lowCreditNotifiedAt = :ts",
        ConditionExpression: "attribute_exists(orgId) AND attribute_not_exists(lowCreditNotifiedAt)",
        ExpressionAttributeValues: { ":ts": S(nowIso()) },
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return false; // already notified (or org gone)
    throw e;
  }
}

/** listAllOrgs(): every org (Scan) — for the ShieldSync ADMIN console only (create
 *  org / adjust credits / oversee accounts). Not employer-facing. Org count is small
 *  and admin access is infrequent, so a full-table Scan is fine here. */
export async function listAllOrgs() {
  const db = await ddb();
  const r = await db.send(new ScanCommand({ TableName: ORGS_TABLE }));
  return (r.Items ?? []).map(itemToObject);
}

// ── ASSESSMENTS ──────────────────────────────────────────────────────────────

// Report links (employer /r/<token> and candidate /r/c/<token>) are valid for 90
// days from creation (or from the latest renew). Rows written BEFORE this field
// existed have no reportExpiresAt and stay valid indefinitely; revocation is
// always honored regardless (see the handler's report-access checks).
const REPORT_LINK_DAYS = 90;

/** reportExpiryIso(): ISO timestamp 90 days from now -- the expiry a fresh or
 *  renewed report link gets. */
function reportExpiryIso() {
  return new Date((now() + REPORT_LINK_DAYS * DAYS) * 1000).toISOString();
}

/** createAssessment(): one per "job" (which lab, name, whether hints are on). Mints
 *  both the assessmentId (internal) and reportToken (the employer's secret /r/<token>
 *  comparison-report link) up front. */
export async function createAssessment({ orgId, labSlug, name, hintsOn, level, coverage, modules }) {
  const db = await ddb();
  const assessmentId = newToken();
  const reportToken = newToken();
  // Portal v2 (composed): if modules[] is supplied, that's the suite; otherwise
  // derive a single-module suite from labSlug so a v1 assessment == a 1-module v2
  // assessment (full backward compatibility). modules/coverage are stored as JSON
  // strings and are DORMANT until the v2 attempt-orchestration consumes them --
  // the v1 read/lease path only ever reads `labSlug`, which is preserved.
  // See docs/ENTERPRISE-PORTAL-V2-SPEC.md.
  const hasModules = Array.isArray(modules) && modules.length > 0;
  const suite = hasModules
    ? modules
    : (labSlug ? [{ moduleId: labSlug, labSlug, weight: 1 }] : []);
  const primaryLab = hasModules ? (modules[0]?.labSlug ?? "") : (labSlug ?? "");
  const item = {
    assessmentId: S(assessmentId),
    orgId: S(orgId),
    labSlug: S(primaryLab), // retained: v1 flows + the first module's lab
    name: S(name ?? ""),
    hintsOn: BOOL(hintsOn),
    reportToken: S(reportToken),
    reportExpiresAt: S(reportExpiryIso()),
    createdAt: S(nowIso()),
    schemaV: N(hasModules ? 2 : 1),
    modules: S(JSON.stringify(suite)),
  };
  if (typeof level === "number") item.level = N(level);
  if (coverage && typeof coverage === "object") item.coverage = S(JSON.stringify(coverage));
  await db.send(new PutItemCommand({ TableName: ASSESSMENTS_TABLE, Item: item }));
  return itemToObject(item);
}

/** getAssessment(): fetch one assessment by id, or null. */
export async function getAssessment(assessmentId) {
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: ASSESSMENTS_TABLE, Key: { assessmentId: S(assessmentId) } }));
  return itemToObject(r.Item);
}

/** getAssessmentByReportToken(): resolve the employer's /r/<reportToken> comparison
 *  link via reportToken-index. Returns the first match or null (token is a 128-bit
 *  CSPRNG value so a collision is not a real-world concern). */
export async function getAssessmentByReportToken(reportToken) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: ASSESSMENTS_TABLE,
      IndexName: "reportToken-index",
      KeyConditionExpression: "reportToken = :t",
      ExpressionAttributeValues: { ":t": S(reportToken) },
      Limit: 1,
    })
  );
  return itemToObject(r.Items?.[0]);
}

/** listAssessments(): every assessment an org has created, via orgId-index. */
export async function listAssessments(orgId) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: ASSESSMENTS_TABLE,
      IndexName: "orgId-index",
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": S(orgId) },
    })
  );
  return (r.Items ?? []).map(itemToObject);
}

/**
 * updateAssessment(): patch an assessment's editable settings (W3B-4: name /
 * hintsOn). Guarded by attribute_exists(assessmentId) so a bad id is a clean
 * null (the handler maps that to 404), never a phantom row. ORG-OWNERSHIP is
 * verified APP-SIDE before this is called -- the engine only checks existence.
 * Returns the updated assessment, or null when no such assessment exists.
 */
export async function updateAssessment(assessmentId, patch = {}) {
  const db = await ddb();
  const names = {};
  const values = {};
  const sets = [];
  let i = 0;
  const put = (field, av) => {
    names[`#f${i}`] = field;
    values[`:v${i}`] = av;
    sets.push(`#f${i} = :v${i}`);
    i++;
  };
  if (patch.name !== undefined) put("name", S(patch.name));
  if (patch.hintsOn !== undefined) put("hintsOn", BOOL(patch.hintsOn));
  // Nothing to change -- return the current row so the caller still gets a
  // {found} signal (the handler rejects an empty patch before reaching here).
  if (sets.length === 0) return getAssessment(assessmentId);
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: ASSESSMENTS_TABLE,
        Key: { assessmentId: S(assessmentId) },
        UpdateExpression: "SET " + sets.join(", "),
        ConditionExpression: "attribute_exists(assessmentId)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

// -- REPORT-TOKEN LIFECYCLE (E1) ----------------------------------------------
//
// Revoke stamps a *RevokedAt timestamp; renew clears it and pushes expiry out
// another 90 days. All four are guarded by attribute_exists on the row key so a
// bad id is a clean null (the handler maps that to 404), never a phantom row.

/** revokeAssessmentReport(): kill the employer's /r/<token> link. Returns the
 *  updated assessment, or null if no such assessment. Idempotent (re-stamps). */
export async function revokeAssessmentReport(assessmentId) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: ASSESSMENTS_TABLE,
        Key: { assessmentId: S(assessmentId) },
        UpdateExpression: "SET reportRevokedAt = :ts",
        ConditionExpression: "attribute_exists(assessmentId)",
        ExpressionAttributeValues: { ":ts": S(nowIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

/** renewAssessmentReport(): un-revoke + extend the employer report link to
 *  now + 90d. Returns the updated assessment, or null if no such assessment. */
export async function renewAssessmentReport(assessmentId) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: ASSESSMENTS_TABLE,
        Key: { assessmentId: S(assessmentId) },
        UpdateExpression: "SET reportExpiresAt = :exp REMOVE reportRevokedAt",
        ConditionExpression: "attribute_exists(assessmentId)",
        ExpressionAttributeValues: { ":exp": S(reportExpiryIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

/** revokeCandidateReport(): kill the candidate's /r/c/<token> link. Returns the
 *  updated invite, or null if no such invite. Idempotent (re-stamps). */
export async function revokeCandidateReport(inviteToken) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET candidateReportRevokedAt = :ts",
        ConditionExpression: "attribute_exists(inviteToken)",
        ExpressionAttributeValues: { ":ts": S(nowIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

/** renewCandidateReport(): un-revoke + extend the candidate report link to
 *  now + 90d. Returns the updated invite, or null if no such invite. */
export async function renewCandidateReport(inviteToken) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET candidateReportExpiresAt = :exp REMOVE candidateReportRevokedAt",
        ConditionExpression: "attribute_exists(inviteToken)",
        ExpressionAttributeValues: { ":exp": S(reportExpiryIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

// ── INVITES ──────────────────────────────────────────────────────────────────

// Invite rows keep candidate PII + OTP state for a bounded window: the candidate
// link itself expires in 7 days, but the ROW (for audit/report replay) is kept for
// 24 months via ttl, matching the Results table's retention.
const INVITE_LINK_DAYS = 7;
const INVITE_ROW_RETENTION = 24 * MONTHS;

/**
 * createInvite(): mint one candidate invite AND consume exactly one org credit,
 * atomically. inviteToken is CLIENT-SUPPLIED (the caller mints it via newToken())
 * specifically so a retried request (e.g. a network-retried POST) is IDEMPOTENT —
 * the same inviteToken replays into the same TransactWriteItems call, which either
 * (a) succeeds fresh once, or (b) fails ONLY the invite-put's existence condition on
 * every subsequent replay, which we detect and turn into a no-op success.
 *
 * The transaction has exactly two actions so "invite created" and "credit consumed"
 * can never be observed independently:
 *   1. Put ShieldSyncEntInvites  — ConditionExpression: attribute_not_exists(inviteToken)
 *   2. Update ShieldSyncEntOrgs  — ConditionExpression: creditsUsed < creditsTotal
 *
 * On TransactionCanceledException we inspect CancellationReasons (same order as the
 * TransactItems array) to tell the two failure modes apart:
 *   - reasons[0].Code === "ConditionalCheckFailed" -> this inviteToken already exists
 *     -> RETRY of an existing invite -> fetch + return it, creditConsumed:false.
 *   - reasons[1].Code === "ConditionalCheckFailed" -> the org has no spare credit
 *     -> throw a clear NO_CREDITS error (nothing was written).
 */
export async function createInvite({ assessmentId, orgId, candidateName, candidateEmail, inviteToken }) {
  const db = await ddb();
  const candidateReportToken = newToken();
  const createdAt = now();
  const item = {
    inviteToken: S(inviteToken),
    assessmentId: S(assessmentId),
    orgId: S(orgId),
    candidateName: S(candidateName ?? ""),
    candidateEmail: S(candidateEmail ?? ""),
    candidateReportToken: S(candidateReportToken),
    candidateReportExpiresAt: S(reportExpiryIso()),
    status: S("created"),
    createdAt: S(new Date(createdAt * 1000).toISOString()),
    expiresAt: S(new Date((createdAt + INVITE_LINK_DAYS * DAYS) * 1000).toISOString()),
    ttl: N(createdAt + INVITE_ROW_RETENTION),
    otpAttempts: N(0),
    otpLocked: BOOL(false),
    consumedCompute: BOOL(false),
    refunded: BOOL(false),
  };

  try {
    await db.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: INVITES_TABLE,
              Item: item,
              ConditionExpression: "attribute_not_exists(inviteToken)",
            },
          },
          {
            Update: {
              TableName: ORGS_TABLE,
              Key: { orgId: S(orgId) },
              UpdateExpression: "ADD creditsUsed :one",
              ConditionExpression: "creditsUsed < creditsTotal",
              ExpressionAttributeValues: { ":one": N(1) },
            },
          },
        ],
      })
    );
    return { invite: itemToObject(item), creditConsumed: true };
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const reasons = e.CancellationReasons ?? [];
      const inviteFailed = reasons[0]?.Code === "ConditionalCheckFailed";
      const orgFailed = reasons[1]?.Code === "ConditionalCheckFailed";
      if (inviteFailed) {
        // This exact inviteToken already exists -> idempotent retry, not an error.
        const existing = await getInvite(inviteToken);
        return { invite: existing, creditConsumed: false };
      }
      if (orgFailed) {
        const err = new Error("NO_CREDITS");
        err.code = "NO_CREDITS";
        throw err;
      }
    }
    throw e;
  }
}

/** getInvite(): fetch one invite by its token, or null. */
export async function getInvite(inviteToken) {
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: INVITES_TABLE, Key: { inviteToken: S(inviteToken) } }));
  return itemToObject(r.Item);
}

/**
 * eraseCandidatePii(): fulfil a data-subject erasure request (DPDP / GDPR right
 * to be forgotten). REDACTS the candidate's direct identifiers in place rather
 * than hard-deleting rows, so the anonymized assessment/score skeleton survives
 * for the employer's legitimate record and the credit ledger stays intact.
 * Blanks candidateName/candidateEmail and drops the OTP hash on the invite, and
 * blanks the free-text reflection on the result (the only PII stored there).
 * ALSO stamps candidateReportRevokedAt (E2 erasure cascade) so the candidate's
 * /r/c/<token> report link 404s after the erase -- an erased person's scored
 * report must not stay reachable via a link that may sit in old emails.
 * Idempotent. Returns { ok:false, notFound:true } if no invite matches.
 */
export async function eraseCandidatePii(inviteToken) {
  const db = await ddb();
  const invite = await getInvite(inviteToken);
  if (!invite) return { ok: false, notFound: true };
  const erasedAt = new Date(now() * 1000).toISOString();

  await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression:
        "SET candidateName = :redacted, candidateEmail = :redacted, erasedAt = :ts, candidateReportRevokedAt = :ts REMOVE otpHash",
      ExpressionAttributeValues: { ":redacted": S("[erased]"), ":ts": S(erasedAt) },
    })
  );

  // Blank the reflection on the candidate's result, if they submitted one.
  // Result rows are keyed (assessmentId, inviteToken); the condition keeps this
  // a no-op when no result exists rather than creating a phantom row.
  if (invite.assessmentId) {
    try {
      await db.send(
        new UpdateItemCommand({
          TableName: RESULTS_TABLE,
          Key: { assessmentId: S(invite.assessmentId), inviteToken: S(inviteToken) },
          UpdateExpression: "SET reflectionText = :redacted, erasedAt = :ts",
          ExpressionAttributeValues: { ":redacted": S("[erased]"), ":ts": S(erasedAt) },
          ConditionExpression: "attribute_exists(assessmentId)",
        })
      );
    } catch {
      // No result row for this invite -- nothing to redact there.
    }
  }

  return { ok: true, erasedAt };
}

/** getInviteByCandidateReportToken(): resolve the candidate's own /r/c/<token>
 *  report link via candidateReportToken-index. First match or null. */
export async function getInviteByCandidateReportToken(token) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: "candidateReportToken-index",
      KeyConditionExpression: "candidateReportToken = :t",
      ExpressionAttributeValues: { ":t": S(token) },
      Limit: 1,
    })
  );
  return itemToObject(r.Items?.[0]);
}

/** listInvites(): every candidate invited into an assessment, via assessmentId-index. */
export async function listInvites(assessmentId) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: "assessmentId-index",
      KeyConditionExpression: "assessmentId = :a",
      ExpressionAttributeValues: { ":a": S(assessmentId) },
    })
  );
  return (r.Items ?? []).map(itemToObject);
}

// Map a plain JS value to the right AttributeValue shape for setInviteStatus's
// dynamic `extra` fields. Keeps that function generic without a giant switch.
function attrFor(value) {
  if (typeof value === "boolean") return BOOL(value);
  if (typeof value === "number") return N(value);
  if (Array.isArray(value)) return SS_or_undef(value);
  return S(value);
}

/**
 * setInviteStatus(): update status plus an arbitrary bag of extra fields (e.g.
 * slotKey/slotAt/sessionId/consentVersion/consentAt/consumedCompute). No condition
 * — this is a general-purpose status/field writer used throughout the candidate
 * flow, not a security-sensitive transition (those get their own guarded function).
 */
export async function setInviteStatus(inviteToken, status, extra = {}) {
  const db = await ddb();
  const names = { "#s": "status" };
  const values = { ":s": S(status) };
  const sets = ["#s = :s"];
  let i = 0;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    const nameKey = `#f${i}`;
    const valueKey = `:v${i}`;
    names[nameKey] = k;
    values[valueKey] = attrFor(v);
    sets.push(`${nameKey} = ${valueKey}`);
    i++;
  }
  const r = await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );
  return itemToObject(r.Attributes);
}

/**
 * stampAzureSession(): write Azure session handles onto the invite WITHOUT touching
 * `status`. The Azure lab lifecycle (azure-infra.mjs) has no separate session table
 * -- labinfra owns the AWS account-pool sessions, but Azure's disposable unit is a
 * per-session RESOURCE GROUP whose per-session state (resource group, deployed
 * storage account, anonymous blob URL, deployment-stack name, ready/error flags)
 * lives on the invite so /ent/submit can grade + tear it down later. The async
 * deploy-azure worker calls this AFTER it provisions, so it must NOT re-set status
 * (that would clobber a candidate who has already submitted in the meantime).
 * Guarded by attribute_exists so a vanished invite is a clean null. Mirrors the
 * generic field-SET shape of setInviteStatus, minus the status write.
 */
export async function stampAzureSession(inviteToken, extra = {}) {
  const db = await ddb();
  const names = {};
  const values = {};
  const sets = [];
  let i = 0;
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    const nameKey = `#f${i}`;
    const valueKey = `:v${i}`;
    names[nameKey] = k;
    values[valueKey] = attrFor(v);
    sets.push(`${nameKey} = ${valueKey}`);
    i++;
  }
  if (sets.length === 0) return await getInvite(inviteToken);
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET " + sets.join(", "),
        ConditionExpression: "attribute_exists(inviteToken)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

/**
 * refundInvite(): idempotent, exactly-once credit-back for an invite (e.g. the
 * employer revokes before the candidate ever starts, or a technical failure voids
 * the attempt). Needs the invite's orgId first, so we getInvite() before the
 * transaction. Two actions, guarded so a second call is a safe no-op:
 *   1. Update invite  — SET status="refunded", refunded=true
 *      ConditionExpression: attribute_not_exists(refunded) OR refunded = :false
 *   2. Update org     — ADD creditsUsed :negone (-1)
 * On TransactionCanceledException where the INVITE condition failed, the invite was
 * already refunded -> return {refunded:false} (no-op). Any other cancellation
 * reason is rethrown. We deliberately do NOT re-check creditsUsed >= 1 on the org
 * update: the invite-side `refunded` flag is the single source of truth guarding
 * against a double refund, so creditsUsed can never be driven below 0 in practice
 * (a credit can only be refunded once per invite, and it was only ever incremented
 * once by createInvite).
 */
export async function refundInvite(inviteToken) {
  const db = await ddb();
  const invite = await getInvite(inviteToken);
  if (!invite) {
    const err = new Error("INVITE_NOT_FOUND");
    err.code = "INVITE_NOT_FOUND";
    throw err;
  }
  try {
    await db.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: INVITES_TABLE,
              Key: { inviteToken: S(inviteToken) },
              UpdateExpression: "SET #s = :refunded, refunded = :true",
              ConditionExpression: "attribute_not_exists(refunded) OR refunded = :false",
              ExpressionAttributeNames: { "#s": "status" },
              ExpressionAttributeValues: { ":refunded": S("refunded"), ":true": BOOL(true), ":false": BOOL(false) },
            },
          },
          {
            Update: {
              TableName: ORGS_TABLE,
              Key: { orgId: S(invite.orgId) },
              UpdateExpression: "ADD creditsUsed :negone",
              ExpressionAttributeValues: { ":negone": N(-1) },
            },
          },
        ],
      })
    );
    return { refunded: true };
  } catch (e) {
    if (e.name === "TransactionCanceledException") {
      const reasons = e.CancellationReasons ?? [];
      if (reasons[0]?.Code === "ConditionalCheckFailed") {
        // Already refunded by a prior call -> idempotent no-op.
        return { refunded: false };
      }
    }
    throw e;
  }
}

/** revokeInvite(): the employer intentionally kills the link. NO credit back —
 *  unlike refundInvite, this is a deliberate action on a still-usable invite, so
 *  the credit stays consumed. Plain status write via setInviteStatus. */
export async function revokeInvite(inviteToken) {
  return setInviteStatus(inviteToken, "revoked");
}

/**
 * stampInviteResend(): record resendLastAt (epoch SECONDS) for the magic-link
 * resend cooldown (W3B-3). Deliberately does NOT touch status -- a resend is not
 * a state transition and NEVER charges a credit. Stamped BEFORE the SES send (as
 * setOtp stamps otpLastSentAt) so a send that fails at SES still throttles the
 * next attempt. Guarded by attribute_exists so a vanished invite is a clean null.
 * Returns the updated invite, or null if no such invite.
 */
export async function stampInviteResend(inviteToken) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET resendLastAt = :ts",
        ConditionExpression: "attribute_exists(inviteToken)",
        ExpressionAttributeValues: { ":ts": N(now()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

// Dispute log cap (E6): the newest PROBLEMS_MAX entries are kept, oldest dropped.
// The cap is anti-abuse (bounds item size); the read-modify-write here is fine
// because a lost update between two simultaneous reports of the SAME invite only
// costs a log entry, never money or state.
const PROBLEMS_MAX = 10;

/**
 * appendProblem(): append one { ts, message, actor } entry to invite.problems[]
 * (E6 dispute path), capped at PROBLEMS_MAX with the oldest dropped. The caller
 * has already clamped message/actor lengths. Returns { entry, notify } (notify =
 * ops email allowed, see below), or null if no such invite.
 */
export async function appendProblem(inviteToken, { message, actor }) {
  const db = await ddb();
  const invite = await getInvite(inviteToken);
  if (!invite) return null;
  const entry = { ts: nowIso(), message, actor };
  const prior = Array.isArray(invite.problems) ? invite.problems : [];
  const problems = [...prior, entry].slice(-PROBLEMS_MAX);
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET problems = :p",
        ConditionExpression: "attribute_exists(inviteToken)",
        ExpressionAttributeValues: { ":p": marshalValue(problems) },
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null; // invite vanished between read and write
    throw e;
  }
  // notify = ops email allowed: first problem on this invite, or the newest
  // prior entry is older than 15 min (SES-quota abuse guard; the caller skips
  // the email when false, the log itself always records).
  const lastTs = prior.length ? Date.parse(prior[prior.length - 1].ts) || 0 : 0;
  return { entry, notify: !lastTs || Date.now() - lastTs > 15 * 60 * 1000 };
}

/**
 * consentInvite(): record click-through consent and move the invite to "consented".
 * GUARDED transition (unlike the generic setInviteStatus): only allowed from a
 * PRE-lease state (created / consented / verified) so an invite that already holds
 * a leased sandbox account (booked / started) or is terminal (revoked / submitted /
 * refunded) cannot be reset back through the state machine to mint a second account
 * or bypass a revoke. Idempotent for created->consented and consented->consented.
 * Throws NOT_CONSENTABLE (the handler maps this to 409) when the condition fails.
 */
export async function consentInvite(inviteToken, consentVersion) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET #s = :consented, consentVersion = :cv, consentAt = :at",
        ConditionExpression: "#s IN (:created, :consented, :verified)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":consented": S("consented"),
          ":created": S("created"),
          ":verified": S("verified"),
          ":cv": S(consentVersion ?? ""),
          ":at": S(nowIso()),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const err = new Error("NOT_CONSENTABLE");
      err.code = "NOT_CONSENTABLE";
      throw err;
    }
    throw e;
  }
}

/**
 * claimStartLease(): atomically reserve THIS invite for a SINGLE fresh sandbox
 * lease, so two concurrent /ent/start calls can't each call leaseEnt() and grab
 * (then orphan) a different account — which, with a tiny account pool, is a
 * trivial whole-product DoS. Only ONE concurrent caller wins: succeeds from
 * "booked" with no sessionId and no live claim; a crashed claim self-frees after
 * START_CLAIM_TTL_MS. Returns true if THIS caller won (proceed to leaseEnt),
 * false otherwise (caller re-reads → reconnects or asks the app to retry).
 */
const START_CLAIM_TTL_MS = 2 * 60 * 1000;
export async function claimStartLease(inviteToken) {
  const db = await ddb();
  const staleBefore = new Date(Date.now() - START_CLAIM_TTL_MS).toISOString();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET leaseClaimAt = :now",
        ConditionExpression:
          "attribute_not_exists(sessionId) AND #s = :booked AND (attribute_not_exists(leaseClaimAt) OR leaseClaimAt < :stale)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":now": S(nowIso()),
          ":booked": S("booked"),
          ":stale": S(staleBefore),
        },
      })
    );
    return true;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return false;
    throw e;
  }
}

/**
 * releaseStartClaim(): free a lease claim taken by claimStartLease when the start
 * attempt did NOT actually lease an account (e.g. leaseEnt threw NO_CAPACITY on a
 * cold/empty pool). Without this, the claim would block the candidate's own retries
 * for the full START_CLAIM_TTL (~2 min) with 409s instead of retrying the lease.
 * Guarded on no session so a real in-flight lease is never cleared. Best-effort.
 */
export async function releaseStartClaim(inviteToken) {
  const db = await ddb();
  await db
    .send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "REMOVE leaseClaimAt",
        ConditionExpression: "attribute_not_exists(sessionId)",
      })
    )
    .catch(() => {});
}

// ── OTP (Fix H — brute-force resistant) ─────────────────────────────────────

const OTP_TTL_SECONDS = 10 * 60;
const OTP_MAX_ATTEMPTS = 5;

/** setOtp(): store a fresh OTP hash for an invite and reset the PER-CODE attempt
 *  counter. Called each time a new code is sent (e.g. "resend code").
 *
 *  Deliberately does NOT touch otpLocked: once an invite is locked (OTP_MAX_ATTEMPTS
 *  failed verify attempts) a resend must NOT unlock it. The lock is STICKY - a fresh
 *  code may be issued but the invite stays unusable until admin/ops intervention.
 *  `meta` carries the send-throttle bookkeeping (otpLastSentAt / otpSendWindowStart /
 *  otpSendCount) which the CALLER computes and which setOtp only WRITES - it never
 *  resets these, so the per-invite cooldown + daily cap survive a resend. */
export async function setOtp(inviteToken, code, meta = {}) {
  const db = await ddb();
  const sets = ["otpHash = :h", "otpExpiresAt = :exp", "otpAttempts = :zero"];
  const values = {
    ":h": S(hashOtp(code)),
    ":exp": N(now() + OTP_TTL_SECONDS),
    ":zero": N(0),
  };
  if (meta.lastSentAt !== undefined) {
    sets.push("otpLastSentAt = :ls");
    values[":ls"] = N(meta.lastSentAt);
  }
  if (meta.windowStart !== undefined) {
    sets.push("otpSendWindowStart = :ws");
    values[":ws"] = N(meta.windowStart);
  }
  if (meta.sendCount !== undefined) {
    sets.push("otpSendCount = :sc");
    values[":sc"] = N(meta.sendCount);
  }
  await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeValues: values,
    })
  );
}

/**
 * claimOtpAttempt(): atomically reserve ONE verification attempt against the OTP
 * cap BEFORE the submitted code is compared. This is the real brute-force bound:
 * a burst of concurrent guesses would otherwise each read a stale otpAttempts and
 * slip past the 5-try lock (TOCTOU). DynamoDB evaluates the ConditionExpression
 * against the CURRENT stored counter, so at most OTP_MAX_ATTEMPTS increments ever
 * succeed; every excess concurrent guess fails the condition and is treated as
 * locked. Returns { attempts } (the post-increment count) on success, or
 * { locked:true } when the cap is already reached or the code was consumed.
 * Shared by the invite (verifyOtp) and doc-signing (acceptDoc) OTP paths.
 */
async function claimOtpAttempt(table, keyName, keyVal) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: table,
        Key: { [keyName]: S(keyVal) },
        UpdateExpression: "ADD otpAttempts :one",
        ConditionExpression: "attribute_exists(otpHash) AND (attribute_not_exists(otpAttempts) OR otpAttempts < :max)",
        ExpressionAttributeValues: { ":one": N(1), ":max": N(OTP_MAX_ATTEMPTS) },
        ReturnValues: "UPDATED_NEW",
      })
    );
    return { attempts: Number(r.Attributes?.otpAttempts?.N ?? OTP_MAX_ATTEMPTS) };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      // At the cap (or the code was already consumed) — make the lock sticky.
      await db
        .send(
          new UpdateItemCommand({
            TableName: table,
            Key: { [keyName]: S(keyVal) },
            UpdateExpression: "SET otpLocked = :true",
            ExpressionAttributeValues: { ":true": BOOL(true) },
          })
        )
        .catch(() => {});
      return { locked: true };
    }
    throw e;
  }
}

/**
 * verifyOtp(): check a candidate-submitted code against the stored hash.
 *   - notFound    -> {ok:false, notFound:true}
 *   - linkExpired -> {ok:false, linkExpired:true} (the 7-day invite link is dead)
 *   - locked      -> {ok:false, locked:true} (no further comparison attempted)
 *   - expired     -> {ok:false, expired:true} (this code's 10-min TTL passed)
 *   - mismatch    -> ADD otpAttempts :1; lock at OTP_MAX_ATTEMPTS; {ok:false, attemptsLeft}
 *   - not OTP-eligible -> {ok:false, notVerifiable:true, status} (correct code but the
 *       invite is revoked/booked/started/submitted -> transition refused)
 *   - match       -> ATOMIC conditional transition to "verified", {ok:true}
 * The comparison itself uses crypto.timingSafeEqual on equal-length hex-decoded
 * buffers (both sides are fixed-length SHA-256 hex digests, so lengths always
 * match) to avoid a timing side-channel on the stored hash.
 */
export async function verifyOtp(inviteToken, code) {
  const invite = await getInvite(inviteToken);
  if (!invite) return { ok: false, notFound: true };
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return { ok: false, linkExpired: true };
  if (invite.otpLocked) return { ok: false, locked: true };
  if (!invite.otpExpiresAt || now() > invite.otpExpiresAt) return { ok: false, expired: true };

  // Atomically CLAIM an attempt slot BEFORE comparing (TOCTOU guard — the early
  // otpLocked check above is only a fast path, not the real bound).
  const slot = await claimOtpAttempt(INVITES_TABLE, "inviteToken", inviteToken);
  if (slot.locked) return { ok: false, locked: true };
  const attempts = slot.attempts;

  const candidateHash = Buffer.from(hashOtp(code), "hex");
  const storedHash = Buffer.from(invite.otpHash ?? "", "hex");
  const match = candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);

  if (match) {
    // ATOMIC, CONDITIONAL transition to "verified" - a single UpdateItem guarded by
    // a ConditionExpression, NOT a read-then-write. This is the one guard that:
    //   (a) enforces server-side consent - a candidate who skipped /ent/consent is
    //       still "created" (not "consented"), so the condition fails and they
    //       cannot verify; and
    //   (b) blocks a revoked / booked / started / submitted invite from being
    //       flipped back to "verified" (revoke bypass, unlimited retakes, a second
    //       leased sandbox account, or a result overwrite).
    // Correct-code-but-wrong-state is a state-machine violation, NOT a brute-force
    // attempt, so it does not burn an attempt.
    const db = await ddb();
    try {
      await db.send(
        new UpdateItemCommand({
          TableName: INVITES_TABLE,
          Key: { inviteToken: S(inviteToken) },
          UpdateExpression: "REMOVE otpHash, otpExpiresAt SET #s = :verified, otpAttempts = :zero",
          ConditionExpression: "#s IN (:consented, :verified)",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":verified": S("verified"),
            ":consented": S("consented"),
            ":zero": N(0),
          },
        })
      );
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") {
        return { ok: false, notVerifiable: true, status: invite.status };
      }
      throw e;
    }
    return { ok: true };
  }

  // Mismatch: the attempt was already consumed by the atomic claim above. Make the
  // lock sticky once the cap is reached (idempotent, best-effort).
  if (attempts >= OTP_MAX_ATTEMPTS) {
    const db = await ddb();
    await db
      .send(
        new UpdateItemCommand({
          TableName: INVITES_TABLE,
          Key: { inviteToken: S(inviteToken) },
          UpdateExpression: "SET otpLocked = :true",
          ExpressionAttributeValues: { ":true": BOOL(true) },
        })
      )
      .catch(() => {});
  }
  return { ok: false, attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts) };
}

// ── SLOTS (pure counter — capacity is passed IN by the caller; this module never
// reads capacity from labinfra or anywhere else) ────────────────────────────────

/**
 * bookSlot(): atomically claim one seat in `slotKey`, guarded by `capacity` (passed
 * in by the caller — e.g. the real number of reserved sandbox accounts for that
 * time window). ADD booked :one only proceeds if either the row doesn't exist yet
 * or booked is still under capacity; list_append + if_not_exists grows the token
 * list from empty.
 *
 * ttl is set to a day PAST THE SLOT TIME, derived from slotKey (which is the slot's
 * ISO timestamp). This is deliberate: a candidate can book a slot up to 7 days out
 * (the link lifetime), so a naive now()+1d ttl would TTL-delete the counter row
 * BEFORE the slot occurs, resetting `booked` to 0 and silently allowing over-booking
 * past capacity. Anchoring ttl to the slot time keeps the counter authoritative
 * through the whole booking window. Falls back to now()+1d only if slotKey isn't a
 * parseable date.
 */
export async function bookSlot(slotKey, capacity, inviteToken) {
  const db = await ddb();
  const slotEpoch = Math.floor(Date.parse(slotKey) / 1000);
  const slotTtl = (Number.isFinite(slotEpoch) ? slotEpoch : now()) + DAYS;
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: SLOTS_TABLE,
        Key: { slotKey: S(slotKey) },
        // `ttl` is a DynamoDB reserved keyword — it MUST be aliased via
        // ExpressionAttributeNames or the whole UpdateItem throws
        // ValidationException. Without this alias, /ent/book 500s every time
        // and no slot is ever written (root cause: booking never worked).
        UpdateExpression:
          "ADD booked :one SET inviteTokens = list_append(if_not_exists(inviteTokens, :empty), :it), #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(booked) OR booked < :cap",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":one": N(1),
          ":cap": N(capacity),
          ":empty": { L: [] },
          ":it": { L: [S(inviteToken)] },
          ":ttl": N(slotTtl),
        },
      })
    );
    return { ok: true };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return { ok: false, full: true };
    throw e;
  }
}

/**
 * releaseSlot(): give back one seat (e.g. the candidate cancels/reschedules).
 * Simplest safe form: ADD booked :negone guarded by booked > 0 so the counter can
 * never go negative. NOTE: this does NOT remove `inviteToken` from the
 * `inviteTokens` list (removing a specific element from a DynamoDB list needs a
 * read-modify-write or a REMOVE by index, which races with concurrent bookings) —
 * the list is therefore a append-only booking log, not a live "currently booked"
 * set. If an exact live membership list is ever needed, re-derive it from
 * ShieldSyncEntInvites (slotKey attribute) rather than trusting this list.
 */
export async function releaseSlot(slotKey, inviteToken) {
  const db = await ddb();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: SLOTS_TABLE,
        Key: { slotKey: S(slotKey) },
        UpdateExpression: "ADD booked :negone",
        ConditionExpression: "booked > :zero",
        ExpressionAttributeValues: { ":negone": N(-1), ":zero": N(0) },
      })
    );
    return { ok: true };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return { ok: false }; // already at 0 — nothing to release
    throw e;
  }
}

// ── RESULTS ──────────────────────────────────────────────────────────────────

const RESULT_RETENTION = 24 * MONTHS;

/** putResult(): store a pre-computed report object for one candidate's attempt.
 *  pk=assessmentId, sk=inviteToken. `report` is spread onto the item as-is — the
 *  caller owns its shape (score breakdown, CloudTrail timeline, reflection text). */
export async function putResult(assessmentId, inviteToken, report) {
  const db = await ddb();
  const item = {
    assessmentId: S(assessmentId),
    inviteToken: S(inviteToken),
    ...marshalPlainObject(report ?? {}),
    ttl: N(now() + RESULT_RETENTION),
  };
  await db.send(new PutItemCommand({ TableName: RESULTS_TABLE, Item: item }));
  return itemToObject(item);
}

// Marshal an arbitrary plain JS object (the report) into AttributeValues. Handles
// the JSON-ish types a report realistically contains: string/number/bool/array/
// nested object/null. Not a general DynamoDB marshaller — deliberately narrow.
function marshalValue(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === "boolean") return { BOOL: v };
  if (typeof v === "number") return { N: String(v) };
  if (Array.isArray(v)) return { L: v.map(marshalValue) };
  if (typeof v === "object") return { M: marshalPlainObject(v) };
  return { S: String(v) };
}
function marshalPlainObject(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, marshalValue(v)]));
}
// unwrap() above doesn't handle NULL — extend it narrowly for result payloads only.
function unwrapDeep(v) {
  if (v && "NULL" in v) return null;
  return unwrap(v);
}
function itemToObjectDeep(item) {
  if (!item) return null;
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unwrapDeep(v)]));
}

/** getResult(): one candidate's stored report, or null. */
export async function getResult(assessmentId, inviteToken) {
  const db = await ddb();
  const r = await db.send(
    new GetItemCommand({ TableName: RESULTS_TABLE, Key: { assessmentId: S(assessmentId), inviteToken: S(inviteToken) } })
  );
  return itemToObjectDeep(r.Item);
}

/** listResults(): every stored report for an assessment (Query on pk=assessmentId,
 *  no index needed — this is the base table's own key). Powers the employer's
 *  side-by-side comparison view. */
export async function listResults(assessmentId) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: RESULTS_TABLE,
      KeyConditionExpression: "assessmentId = :a",
      ExpressionAttributeValues: { ":a": S(assessmentId) },
    })
  );
  return (r.Items ?? []).map(itemToObjectDeep);
}

// ── ORDERS ───────────────────────────────────────────────────────────────────

/** createOrder(): a new credit-purchase / GST invoice record, starting "created". */
export async function createOrder({ orgId, invoiceNo, gstin, amountMinor, currency, credits, note }) {
  const db = await ddb();
  const orderId = newToken();
  const item = {
    orderId: S(orderId),
    orgId: S(orgId),
    invoiceNo: S(invoiceNo ?? ""),
    gstin: S(gstin ?? ""),
    amountMinor: N(amountMinor ?? 0),
    currency: S(currency ?? "INR"),
    credits: N(credits ?? 0),
    // Internal founder note (the admin UI offers it) -- persisted on the order
    // so it is not lost to a transient console.log audit line.
    note: S(typeof note === "string" ? note.slice(0, 300) : ""),
    status: S("created"),
    createdAt: S(nowIso()),
  };
  await db.send(new PutItemCommand({ TableName: ORDERS_TABLE, Item: item }));
  return itemToObject(item);
}

/** getOrder(): fetch one order by id, or null. */
export async function getOrder(orderId) {
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: ORDERS_TABLE, Key: { orderId: S(orderId) } }));
  return itemToObject(r.Item);
}

/** listOrders(): an org's billing history, via orgId-index. */
export async function listOrders(orgId) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: "orgId-index",
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": S(orgId) },
    })
  );
  return (r.Items ?? []).map(itemToObject);
}

/**
 * markOrderPaid(): idempotent created->paid transition that ALSO grants the
 * order's credits to the org, exactly once (E4 money loop).
 *
 * The created->paid CAS and the credit ADD ride in ONE TransactWriteItems, so
 * they are a single atomic winner-takes-all step: a webhook retried N times only
 * wins the CAS once, and ONLY that winning transaction carries the ADD -- every
 * retry after the first cancels on the order's ConditionExpression and therefore
 * cannot re-apply the credit. (Same pattern as createInvite/refundInvite; the
 * transaction is strictly safer than CAS-then-separate-ADD, which could lose the
 * grant to a crash between the two writes.)
 *
 * The org update also clears lowCreditNotifiedAt (E5): paid credits are a top-up,
 * which re-arms the low-credit alert.
 */
export async function markOrderPaid(orderId) {
  const db = await ddb();
  const order = await getOrder(orderId);
  if (!order) return { paid: false, notFound: true };
  const credits = Number(order.credits) || 0;
  const orderUpdate = {
    TableName: ORDERS_TABLE,
    Key: { orderId: S(orderId) },
    UpdateExpression: "SET #s = :paid, paidAt = :now",
    ConditionExpression: "#s = :created",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":paid": S("paid"), ":created": S("created"), ":now": S(nowIso()) },
  };
  try {
    if (credits > 0 && order.orgId) {
      await db.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            { Update: orderUpdate },
            {
              Update: {
                TableName: ORGS_TABLE,
                Key: { orgId: S(order.orgId) },
                UpdateExpression: "ADD creditsTotal :c REMOVE lowCreditNotifiedAt",
                // A paid order for a since-deleted org must NOT mint a phantom
                // org row holding only creditsTotal -- cancel the whole
                // transaction instead (order stays `created` for investigation).
                ConditionExpression: "attribute_exists(orgId)",
                ExpressionAttributeValues: { ":c": N(credits) },
              },
            },
          ],
        })
      );
    } else {
      // Zero-credit / malformed order: still flip the status, nothing to grant.
      await db.send(new UpdateItemCommand(orderUpdate));
    }
    return { paid: true, creditsGranted: credits };
  } catch (e) {
    const reasons = e.name === "TransactionCanceledException" ? e.CancellationReasons ?? [] : [];
    const orderCasLost =
      e.name === "ConditionalCheckFailedException" || reasons[0]?.Code === "ConditionalCheckFailed";
    // Order CAS held but the org row is gone: surface it distinctly so the
    // caller/ops can see the order needs manual attention (it stays `created`).
    if (!orderCasLost && reasons[1]?.Code === "ConditionalCheckFailed") {
      return { paid: false, orgMissing: true };
    }
    if (orderCasLost) return { paid: false }; // already paid -- retry is a harmless no-op
    throw e;
  }
}

// -- AGREEMENTS (W3-1 / W3-2: MSA + DPA lifecycle, permanent retention) --------
//
// One row per legal document (Enterprise Agreement "msa" or DPA "dpa") for an
// org. bodyText is the FULL rendered snapshot -- template merged with params,
// including any negotiated (hand-edited) terms -- and sha256 is its integrity
// hash. The hash is recomputed on EVERY bodyText write (create/update) and once
// more at issue time, so an accepted agreement's stored hash always matches the
// exact text the org accepted.
//
// Status machine -- every transition is a ConditionExpression CAS on the row,
// never a read-then-write (same discipline as consentInvite / markOrderPaid):
//   draft  -> issued    (issueAgreement; text immutable from here on)
//   issued -> accepted  (acceptAgreement; TERMINAL. The only way past accepted
//                        is a NEW agreement carrying supersedes=<oldId>, which
//                        on ISSUE best-effort marks the old row "superseded".)
//   draft|issued -> void (voidAgreement; accepted can never be voided)
//
// NO TTL: agreements are permanent legal records, like Orders. The table also
// has PITR enabled (see create-ent-agreements-table.mjs).

/** sha256Hex(): integrity hash of an agreement bodyText snapshot. */
function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/**
 * createAgreement(): mint a new DRAFT agreement row. bodyText arrives fully
 * rendered from the app (template + params + any negotiated edits); the CALLER
 * (handler) has already validated docType / length / params shape. sha256 is
 * computed here so the hash can never drift from the stored text. `supersedes`
 * (optional) names the previously-accepted agreement this one will replace once
 * issued -- the actual mark happens at issue time, not here.
 */
export async function createAgreement({ orgId, docType, templateVersion, params, bodyText, customized, supersedes, actor }) {
  const db = await ddb();
  const agreementId = newToken();
  const item = {
    agreementId: S(agreementId),
    orgId: S(orgId),
    docType: S(docType),
    templateVersion: S(templateVersion ?? ""),
    params: marshalValue(params && typeof params === "object" ? params : {}),
    bodyText: S(bodyText),
    customized: BOOL(customized),
    sha256: S(sha256Hex(bodyText)),
    status: S("draft"),
    createdAt: S(nowIso()),
    createdBy: S(actor ?? ""),
    ...(supersedes ? { supersedes: S(supersedes) } : {}),
  };
  await db.send(new PutItemCommand({ TableName: AGREEMENTS_TABLE, Item: item }));
  return itemToObjectDeep(item);
}

/** getAgreement(): fetch one agreement by id (FULL row incl. bodyText), or null. */
export async function getAgreement(agreementId) {
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: AGREEMENTS_TABLE, Key: { agreementId: S(agreementId) } }));
  return itemToObjectDeep(r.Item);
}

/**
 * listAgreements(): every agreement for an org, via orgId-index. The list stays
 * LIGHT (W3-2): bodyText (up to 200KB per row) is stripped -- callers fetch the
 * full text one row at a time via getAgreement.
 */
export async function listAgreements(orgId) {
  const db = await ddb();
  const r = await db.send(
    new QueryCommand({
      TableName: AGREEMENTS_TABLE,
      IndexName: "orgId-index",
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": S(orgId) },
    })
  );
  return (r.Items ?? []).map((it) => {
    const o = itemToObjectDeep(it);
    delete o.bodyText;
    return o;
  });
}

/**
 * updateAgreementDraft(): patch a DRAFT agreement (bodyText / params /
 * templateVersion / customized). Guarded by ConditionExpression status=draft so
 * an issued/accepted/void row can NEVER be edited -- issued text is immutable.
 * A bodyText patch recomputes sha256 in the SAME update, atomically. Returns
 * the updated row; null if no such agreement; throws NOT_DRAFT (handler -> 409)
 * when the row exists but is past draft.
 */
export async function updateAgreementDraft(agreementId, patch = {}) {
  const db = await ddb();
  const names = { "#s": "status" };
  const values = { ":draft": S("draft"), ":at": S(nowIso()) };
  const sets = ["updatedAt = :at"];
  let i = 0;
  const put = (field, av) => {
    names[`#f${i}`] = field;
    values[`:v${i}`] = av;
    sets.push(`#f${i} = :v${i}`);
    i++;
  };
  if (patch.bodyText !== undefined) {
    put("bodyText", S(patch.bodyText));
    put("sha256", S(sha256Hex(patch.bodyText)));
  }
  if (patch.params !== undefined) put("params", marshalValue(patch.params));
  if (patch.templateVersion !== undefined) put("templateVersion", S(patch.templateVersion));
  if (patch.customized !== undefined) put("customized", BOOL(patch.customized));
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: AGREEMENTS_TABLE,
        Key: { agreementId: S(agreementId) },
        UpdateExpression: "SET " + sets.join(", "),
        ConditionExpression: "#s = :draft",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObjectDeep(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const existing = await getAgreement(agreementId);
      if (!existing) return null;
      const err = new Error("NOT_DRAFT");
      err.code = "NOT_DRAFT";
      err.status = existing.status;
      throw err;
    }
    throw e;
  }
}

/**
 * issueAgreement(): CAS draft->issued. Recomputes + stores sha256 from the
 * current bodyText in the SAME conditional update that flips the status, and
 * stamps issuedAt/issuedBy. After this the text is immutable (updateAgreementDraft
 * refuses non-draft rows). Returns the updated row; null if no such agreement;
 * throws NOT_ISSUABLE (handler -> 409) if the row is not in draft.
 * NOTE: the supersedes cascade (marking the OLD agreement superseded) is the
 * HANDLER's best-effort follow-up via markAgreementSuperseded -- deliberately
 * not part of this write, so a cascade failure can never lose the issue itself.
 */
export async function issueAgreement(agreementId, actor) {
  const db = await ddb();
  const current = await getAgreement(agreementId);
  if (!current) return null;
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: AGREEMENTS_TABLE,
        Key: { agreementId: S(agreementId) },
        // Condition on the sha256 read above as well as the status: a draft
        // edit racing this issue would otherwise freeze an issued row whose
        // stored hash no longer matches its bodyText (TOCTOU). On the race the
        // condition fails -> NOT_ISSUABLE -> the admin re-reads and re-issues.
        UpdateExpression: "SET #s = :issued, issuedAt = :at, issuedBy = :by, sha256 = :h",
        ConditionExpression: "#s = :draft AND sha256 = :h",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":issued": S("issued"),
          ":draft": S("draft"),
          ":at": S(nowIso()),
          ":by": S(actor ?? ""),
          ":h": S(sha256Hex(current.bodyText ?? "")),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObjectDeep(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const err = new Error("NOT_ISSUABLE");
      err.code = "NOT_ISSUABLE";
      err.status = current.status;
      throw err;
    }
    throw e;
  }
}

/**
 * markAgreementSuperseded(): best-effort second write after issuing a
 * replacement agreement -- flips the OLD row (accepted or issued) to
 * "superseded" and records which agreement replaced it. Conditional on the old
 * status still being accepted/issued so a draft/void/already-superseded row is
 * left alone. Returns the updated row, or null when the condition fails or the
 * row is missing (callers log and move on; never fatal).
 */
export async function markAgreementSuperseded(agreementId, supersededById) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: AGREEMENTS_TABLE,
        Key: { agreementId: S(agreementId) },
        UpdateExpression: "SET #s = :superseded, supersededAt = :at, supersededBy = :by",
        ConditionExpression: "#s IN (:accepted, :issued)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":superseded": S("superseded"),
          ":accepted": S("accepted"),
          ":issued": S("issued"),
          ":at": S(nowIso()),
          ":by": S(supersededById ?? ""),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObjectDeep(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

/**
 * acceptAgreement(): CAS issued->accepted, stamping acceptedAt + acceptedBy
 * (the portal user's email, sanitized by the handler). IDEMPOTENT: a repeat
 * call on an already-accepted row returns { agreement, already: true } instead
 * of failing, so a double-click / retried POST never errors the portal. Any
 * other state (draft / void / superseded) throws NOT_ACCEPTABLE (handler ->
 * 409). Returns null if no such agreement.
 */
export async function acceptAgreement(agreementId, acceptedBy) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: AGREEMENTS_TABLE,
        Key: { agreementId: S(agreementId) },
        UpdateExpression: "SET #s = :accepted, acceptedAt = :at, acceptedBy = :by",
        ConditionExpression: "#s = :issued",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":accepted": S("accepted"),
          ":issued": S("issued"),
          ":at": S(nowIso()),
          ":by": S(acceptedBy),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return { agreement: itemToObjectDeep(r.Attributes), already: false };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const existing = await getAgreement(agreementId);
      if (!existing) return null;
      if (existing.status === "accepted") return { agreement: existing, already: true };
      const err = new Error("NOT_ACCEPTABLE");
      err.code = "NOT_ACCEPTABLE";
      err.status = existing.status;
      throw err;
    }
    throw e;
  }
}

/**
 * voidAgreement(): CAS draft|issued -> void. An ACCEPTED agreement can never be
 * voided (it is a signed record; replace it via supersedes instead). Returns the
 * updated row; null if no such agreement; throws NOT_VOIDABLE (handler -> 409)
 * when the row is accepted/superseded/already void.
 */
export async function voidAgreement(agreementId, actor) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: AGREEMENTS_TABLE,
        Key: { agreementId: S(agreementId) },
        UpdateExpression: "SET #s = :void, voidedAt = :at, voidedBy = :by",
        ConditionExpression: "#s IN (:draft, :issued)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: {
          ":void": S("void"),
          ":draft": S("draft"),
          ":issued": S("issued"),
          ":at": S(nowIso()),
          ":by": S(actor ?? ""),
        },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObjectDeep(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const existing = await getAgreement(agreementId);
      if (!existing) return null;
      const err = new Error("NOT_VOIDABLE");
      err.code = "NOT_VOIDABLE";
      err.status = existing.status;
      throw err;
    }
    throw e;
  }
}

/**
 * setOrgAcceptedAgreement(): mirror the just-accepted agreement's version onto
 * the org row (W3-2 accept side-effect). BEST-EFFORT by contract -- the handler
 * catches and logs a failure without failing the accept (the agreement row
 * itself is the source of truth; this mirror only feeds the portal's quick
 * "current version" display). Conditional on the org existing so a race with an
 * org delete can't mint a phantom org row.
 */
export async function setOrgAcceptedAgreement(orgId, version) {
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: ORGS_TABLE,
      Key: { orgId: S(orgId) },
      UpdateExpression: "SET acceptedAgreementVersion = :v, acceptedAt = :at",
      ConditionExpression: "attribute_exists(orgId)",
      ExpressionAttributeValues: { ":v": S(version ?? ""), ":at": S(nowIso()) },
    })
  );
}

// -- AUDIT (W3B-1: durable, permanent audit trail) -----------------------------
//
// One row per privileged mutation, mirroring the greppable console.log audit
// line the handler already emits (that console line STAYS -- it is immediate in
// CloudWatch and effectively free). This table is the queryable, permanent
// record the admin Activity panel reads: pk=auditId, GSI orgId-index
// (pk=orgId, sk=createdAt) so an org's recent events list newest-first without a
// Scan. NO TTL: an audit trail is a permanent record (like Orders/Agreements),
// and the table has PITR (see create-ent-audit-table.mjs).
//
// Writes are BEST-EFFORT at the call site: the handler wraps appendAudit in
// try/catch so a failed audit write can NEVER fail the parent mutation.

/**
 * appendAudit(): write one immutable audit row. `detail` is an arbitrary small
 * plain object (marshalled like a result payload). orgId is the GSI partition
 * key -- when it is falsy the attribute is OMITTED entirely (a DynamoDB index
 * key may not be an empty string, and a sparse index just skips the row) so an
 * unknown-org audit still lands in the base table without throwing.
 */
export async function appendAudit({ orgId, actor, action, target, detail } = {}) {
  const db = await ddb();
  const item = {
    auditId: S(newToken()),
    ...(orgId ? { orgId: S(orgId) } : {}),
    actor: S(actor ?? ""),
    action: S(action ?? ""),
    target: S(target ?? ""),
    detail: marshalValue(detail && typeof detail === "object" ? detail : {}),
    createdAt: S(nowIso()),
  };
  await db.send(new PutItemCommand({ TableName: AUDIT_TABLE, Item: item }));
  return itemToObjectDeep(item);
}

/**
 * listAudit(): an org's recent audit events, newest-first, via orgId-index
 * (pk=orgId, sk=createdAt; ScanIndexForward:false = descending createdAt).
 * `limit` is clamped to [1, 200]. Admin-only (the app enforces the staff gate
 * before calling GET /ent/audit).
 */
export async function listAudit(orgId, limit = 100) {
  const db = await ddb();
  const n = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const r = await db.send(
    new QueryCommand({
      TableName: AUDIT_TABLE,
      IndexName: "orgId-index",
      KeyConditionExpression: "orgId = :o",
      ExpressionAttributeValues: { ":o": S(orgId) },
      ScanIndexForward: false,
      Limit: n,
    })
  );
  return (r.Items ?? []).map(itemToObjectDeep);
}

// -- LEADS (demo requests from the public enterprise landing) ------------------
//
// One row per "Book a walkthrough" / pricing form submission on the PUBLIC site
// (pre-auth, pre-org — a lead has no orgId). pk=leadId. Two row shapes share the
// table: lead rows (permanent — sales pipeline records, tiny volume) and
// `cooldown:<email-hash>` marker rows carrying a `ttl` so DynamoDB TTL sweeps
// them; the marker's conditional put is the per-email flood gate for a route
// that is reachable by anyone on the internet.

const LEADS_TABLE = "ShieldSyncEntLeads";
const LEAD_COOLDOWN_SEC = 10 * 60;
export const LEAD_STATUSES = ["new", "contacted", "closed"];

/**
 * createLead(): persist one demo-request lead. Caller (ent-handler) has already
 * validated/clamped every field — this layer only owns identity, timestamps and
 * the cooldown gate. Returns { cooldown:true } (and writes nothing) when the
 * same email submitted within the last LEAD_COOLDOWN_SEC.
 */
export async function createLead({ name, email, company, topic, message, source }) {
  const db = await ddb();
  const emailHash = createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex").slice(0, 32);
  try {
    await db.send(
      new PutItemCommand({
        TableName: LEADS_TABLE,
        Item: { leadId: S(`cooldown:${emailHash}`), ttl: N(now() + LEAD_COOLDOWN_SEC) },
        ConditionExpression: "attribute_not_exists(leadId)",
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return { cooldown: true };
    throw e;
  }
  const leadId = newToken();
  const item = {
    leadId: S(leadId),
    name: S(name ?? ""),
    email: S(email),
    company: S(company ?? ""),
    topic: S(topic ?? "other"),
    message: S(message ?? ""),
    source: S(source ?? ""),
    status: S("new"),
    createdAt: S(nowIso()),
  };
  await db.send(new PutItemCommand({ TableName: LEADS_TABLE, Item: item }));
  return { cooldown: false, lead: itemToObject(item) };
}

/**
 * listLeads(): every lead, newest-first. A Scan is deliberate (same call as
 * listAllOrgs): lead volume is human-scale and the table has no GSI to pay for.
 * Cooldown marker rows are filtered out via attribute_exists(createdAt) — only
 * real lead rows carry it. Admin-only (the app enforces the staff gate before
 * calling GET /ent/leads).
 */
export async function listLeads() {
  const db = await ddb();
  const r = await db.send(
    new ScanCommand({
      TableName: LEADS_TABLE,
      FilterExpression: "attribute_exists(createdAt)",
    })
  );
  const leads = (r.Items ?? []).map(itemToObject);
  leads.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return leads;
}

/**
 * updateLeadStatus(): staff pipeline transition (new / contacted / closed, any
 * direction). The condition refuses unknown ids AND cooldown marker rows (no
 * createdAt) so a status write can never mint a phantom lead. `status` is
 * validated against LEAD_STATUSES by the handler before this call.
 */
export async function updateLeadStatus(leadId, status) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: LEADS_TABLE,
        Key: { leadId: S(leadId) },
        UpdateExpression: "SET #s = :s, statusUpdatedAt = :at",
        ConditionExpression: "attribute_exists(leadId) AND attribute_exists(createdAt)",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": S(status), ":at": S(nowIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    return itemToObject(r.Attributes);
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return null;
    throw e;
  }
}

// -- DOCUMENTS (doc-signing portal: e-accept SOWs/proposals/agreements) --------
//
// One row per uploaded PDF a named recipient is asked to electronically accept
// via /sign/<docToken>. The PDF bytes live in S3 (ent-handler owns that side);
// this table holds the metadata + the sha256 of the EXACT stored bytes (the
// agreements-table precedent: hash frozen at registration, copied into the
// acceptance record at accept time so the executed record is self-contained).
//
// Status machine -- every transition is a ConditionExpression CAS, never a
// read-then-write (same discipline as the agreements lifecycle):
//   pending -> signed   (acceptDoc; TERMINAL -- the acceptance record fields are
//                        written in the SAME conditional update, so a signed row
//                        is immutable-by-construction: no update path exists.)
//   pending -> revoked  (revokeDoc; a signed record can NEVER be revoked.)
//
// NO TTL: documents + acceptance records are permanent business/legal records,
// like Orders and Agreements. PITR is enabled by create-ent-docs-infra.mjs.
//
// LEGAL NOTE (read before editing any wording that reaches a signer): this flow
// produces click-accept evidence ("electronically accepted") -- it is NOT an
// Aadhaar eSign / DSC digital signature under IT Act section 3, and no string
// in this module or its callers may ever say "digitally signed".

const DOCS_TABLE = "ShieldSyncEntDocs";

/** sha256HexBytes(): the agreements sha256Hex precedent, but over raw bytes
 *  (Buffer) rather than text -- used to hash the exact stored PDF bytes. */
export function sha256HexBytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * createDoc(): register a document row. docToken MUST be caller-supplied (the
 * app mints it once and reuses it on retry -- same idempotency contract as
 * createInvite) and doubles as the /sign/<docToken> bearer credential, so it is
 * never returned by any public endpoint. The conditional put makes a retried
 * register a no-op: on collision the existing row is returned with
 * { already: true } and the HANDLER decides whether the retry is benign
 * (same sha256) or a token-reuse bug (different content -> 409).
 */
export async function createDoc({ docToken, title, fileName, signerName, signerEmail, note, s3Key, sizeBytes, sha256, expiresAt, actor }) {
  const db = await ddb();
  const item = {
    docToken: S(docToken),
    title: S(title),
    fileName: S(fileName),
    signerName: S(signerName ?? ""),
    signerEmail: S(signerEmail),
    note: S(note ?? ""),
    s3Key: S(s3Key),
    sizeBytes: N(sizeBytes),
    sha256: S(sha256),
    status: S("pending"),
    expiresAt: S(expiresAt),
    createdAt: S(nowIso()),
    createdBy: S(actor ?? ""),
  };
  try {
    await db.send(
      new PutItemCommand({
        TableName: DOCS_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(docToken)",
      })
    );
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const existing = await getDoc(docToken);
      return { already: true, doc: existing };
    }
    throw e;
  }
  return { already: false, doc: itemToObject(item) };
}

/** getDoc(): fetch one document row by its token, or null. Full row -- callers
 *  that face the public (GET /ent/doc) must sanitize before returning. */
export async function getDoc(docToken) {
  if (!docToken) return null;
  const db = await ddb();
  const r = await db.send(new GetItemCommand({ TableName: DOCS_TABLE, Key: { docToken: S(docToken) } }));
  return itemToObject(r.Item);
}

/**
 * listDocs(): every document, newest-first. A Scan is deliberate (same as
 * listLeads): document volume is human-scale and the table has no GSI to pay
 * for. otpHash is stripped here so a stored code hash can never reach the app
 * layer at all; docToken stays IN the rows because the admin app needs it
 * server-side to drive actions -- the app renders only 8-char display ids.
 */
export async function listDocs() {
  const db = await ddb();
  const r = await db.send(new ScanCommand({ TableName: DOCS_TABLE }));
  const docs = (r.Items ?? []).map((it) => {
    const o = itemToObject(it);
    delete o.otpHash;
    return o;
  });
  docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return docs;
}

/** setDocOtp(): store a fresh OTP hash on a document row. Same contract as the
 *  invite setOtp: resets attempts for the NEW code, never touches otpLocked
 *  (sticky lock) and only WRITES the send-throttle counters the caller computed
 *  (cooldown + daily cap survive a resend). */
export async function setDocOtp(docToken, code, meta = {}) {
  const db = await ddb();
  const sets = ["otpHash = :h", "otpExpiresAt = :exp", "otpAttempts = :zero"];
  const values = {
    ":h": S(hashOtp(code)),
    ":exp": N(now() + OTP_TTL_SECONDS),
    ":zero": N(0),
  };
  if (meta.lastSentAt !== undefined) {
    sets.push("otpLastSentAt = :ls");
    values[":ls"] = N(meta.lastSentAt);
  }
  if (meta.windowStart !== undefined) {
    sets.push("otpSendWindowStart = :ws");
    values[":ws"] = N(meta.windowStart);
  }
  if (meta.sendCount !== undefined) {
    sets.push("otpSendCount = :sc");
    values[":sc"] = N(meta.sendCount);
  }
  await db.send(
    new UpdateItemCommand({
      TableName: DOCS_TABLE,
      Key: { docToken: S(docToken) },
      UpdateExpression: "SET " + sets.join(", "),
      ExpressionAttributeValues: values,
    })
  );
}

/**
 * acceptDoc(): the whole verify-then-accept in ONE call, so the OTP check and
 * the pending->signed transition can never be split across requests (there is
 * no "verified but not yet accepted" limbo state to attack or to leak).
 * Outcome flags mirror verifyOtp:
 *   - notFound / linkExpired / locked / expired (code TTL) / attemptsLeft (mismatch)
 *   - already: true      -> row is ALREADY signed (idempotent double-click)
 *   - notAcceptable      -> revoked (or other non-pending) row
 *   - ok: true, doc      -> CAS pending->signed committed with the acceptance
 *     record: acceptedAt/acceptedName/acceptedEmail (the OTP-verified address,
 *     copied from the ROW -- never caller input), acceptIp/acceptUa (handler
 *     injects from request headers), docHash (sha256 frozen at registration).
 * The mismatch path burns an attempt and locks at OTP_MAX_ATTEMPTS, exactly
 * like the invite flow -- and the lock is sticky across resends.
 */
export async function acceptDoc(docToken, code, { typedName, ip, userAgent } = {}) {
  const doc = await getDoc(docToken);
  if (!doc) return { ok: false, notFound: true };
  if (doc.status === "signed") return { ok: false, already: true, doc };
  if (doc.status !== "pending") return { ok: false, notAcceptable: true, status: doc.status };
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) return { ok: false, linkExpired: true };
  if (doc.otpLocked) return { ok: false, locked: true };
  if (!doc.otpExpiresAt || now() > doc.otpExpiresAt) return { ok: false, expired: true };

  // Atomically CLAIM an attempt slot BEFORE comparing (same TOCTOU guard as the
  // invite OTP path — bounds concurrent guesses to OTP_MAX_ATTEMPTS).
  const slot = await claimOtpAttempt(DOCS_TABLE, "docToken", docToken);
  if (slot.locked) return { ok: false, locked: true };
  const attempts = slot.attempts;

  const candidateHash = Buffer.from(hashOtp(code), "hex");
  const storedHash = Buffer.from(doc.otpHash ?? "", "hex");
  const match = candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);

  const db = await ddb();
  if (match) {
    try {
      const r = await db.send(
        new UpdateItemCommand({
          TableName: DOCS_TABLE,
          Key: { docToken: S(docToken) },
          UpdateExpression:
            "REMOVE otpHash, otpExpiresAt SET #s = :signed, acceptedAt = :at, acceptedName = :nm, acceptedEmail = :em, acceptIp = :ip, acceptUa = :ua, docHash = :h, otpAttempts = :zero",
          ConditionExpression: "#s = :pending",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":signed": S("signed"),
            ":pending": S("pending"),
            ":at": S(nowIso()),
            ":nm": S(typedName ?? ""),
            ":em": S(doc.signerEmail ?? ""),
            ":ip": S(ip ?? ""),
            ":ua": S(userAgent ?? ""),
            ":h": S(doc.sha256 ?? ""),
            ":zero": N(0),
          },
          ReturnValues: "ALL_NEW",
        })
      );
      const updated = itemToObject(r.Attributes);
      delete updated.otpHash;
      return { ok: true, doc: updated };
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") {
        // Raced by another accept (double-click) or a revoke. Re-read to tell
        // the two apart -- a signed row is the friendly idempotent case.
        const current = await getDoc(docToken);
        if (current?.status === "signed") return { ok: false, already: true, doc: current };
        return { ok: false, notAcceptable: true, status: current?.status };
      }
      throw e;
    }
  }

  // Mismatch: the attempt was already consumed by the atomic claim above. Sticky-
  // lock at the cap (idempotent, best-effort).
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await db
      .send(
        new UpdateItemCommand({
          TableName: DOCS_TABLE,
          Key: { docToken: S(docToken) },
          UpdateExpression: "SET otpLocked = :true",
          ExpressionAttributeValues: { ":true": BOOL(true) },
        })
      )
      .catch(() => {});
  }
  return { ok: false, attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - attempts) };
}

/**
 * revokeDoc(): CAS pending->revoked (admin kills a mistaken/lost link). A
 * signed row can NEVER be revoked -- the acceptance record is permanent; a
 * revoke attempt on it throws NOT_REVOCABLE (handler -> 409). Returns null for
 * an unknown token.
 */
export async function revokeDoc(docToken) {
  const db = await ddb();
  try {
    const r = await db.send(
      new UpdateItemCommand({
        TableName: DOCS_TABLE,
        Key: { docToken: S(docToken) },
        UpdateExpression: "SET #s = :revoked, revokedAt = :at",
        ConditionExpression: "#s = :pending",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":revoked": S("revoked"), ":pending": S("pending"), ":at": S(nowIso()) },
        ReturnValues: "ALL_NEW",
      })
    );
    const updated = itemToObject(r.Attributes);
    delete updated.otpHash;
    return updated;
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") {
      const existing = await getDoc(docToken);
      if (!existing) return null;
      const err = new Error("NOT_REVOCABLE");
      err.code = "NOT_REVOCABLE";
      err.status = existing.status;
      throw err;
    }
    throw e;
  }
}

/** stampDocResend(): cooldown stamp for the signing-link re-send (mirrors
 *  stampInviteResend -- stamped BEFORE the SES send so a failed send still
 *  throttles the next attempt). */
export async function stampDocResend(docToken) {
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: DOCS_TABLE,
      Key: { docToken: S(docToken) },
      UpdateExpression: "SET resendLastAt = :ls",
      ExpressionAttributeValues: { ":ls": N(now()) },
    })
  );
}
