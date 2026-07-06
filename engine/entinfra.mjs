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
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";

const ORGS_TABLE = "ShieldSyncEntOrgs";
const ASSESSMENTS_TABLE = "ShieldSyncEntAssessments";
const INVITES_TABLE = "ShieldSyncEntInvites";
const SLOTS_TABLE = "ShieldSyncEntSlots";
const RESULTS_TABLE = "ShieldSyncEntResults";
const ORDERS_TABLE = "ShieldSyncEntOrders";

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
 * addCredits(): top up an org's credit balance by `delta` (positive integer).
 * Plain ADD on creditsTotal — no condition needed since a top-up can never make
 * the ledger inconsistent (creditsUsed is untouched). Returns the updated org.
 */
export async function addCredits(orgId, delta) {
  const db = await ddb();
  const r = await db.send(
    new UpdateItemCommand({
      TableName: ORGS_TABLE,
      Key: { orgId: S(orgId) },
      UpdateExpression: "ADD creditsTotal :d",
      ExpressionAttributeValues: { ":d": N(delta) },
      ReturnValues: "ALL_NEW",
    })
  );
  return itemToObject(r.Attributes);
}

// ── ASSESSMENTS ──────────────────────────────────────────────────────────────

/** createAssessment(): one per "job" (which lab, name, whether hints are on). Mints
 *  both the assessmentId (internal) and reportToken (the employer's secret /r/<token>
 *  comparison-report link) up front. */
export async function createAssessment({ orgId, labSlug, name, hintsOn }) {
  const db = await ddb();
  const assessmentId = newToken();
  const reportToken = newToken();
  const item = {
    assessmentId: S(assessmentId),
    orgId: S(orgId),
    labSlug: S(labSlug),
    name: S(name ?? ""),
    hintsOn: BOOL(hintsOn),
    reportToken: S(reportToken),
    createdAt: S(nowIso()),
  };
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

// ── OTP (Fix H — brute-force resistant) ─────────────────────────────────────

const OTP_TTL_SECONDS = 10 * 60;
const OTP_MAX_ATTEMPTS = 5;

/** setOtp(): store a fresh OTP hash for an invite, resetting attempt/lock state.
 *  Called each time a new code is sent (e.g. "resend code"). */
export async function setOtp(inviteToken, code) {
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression: "SET otpHash = :h, otpExpiresAt = :exp, otpAttempts = :zero, otpLocked = :false",
      ExpressionAttributeValues: {
        ":h": S(hashOtp(code)),
        ":exp": N(now() + OTP_TTL_SECONDS),
        ":zero": N(0),
        ":false": BOOL(false),
      },
    })
  );
}

/**
 * verifyOtp(): check a candidate-submitted code against the stored hash.
 *   - locked      -> {ok:false, locked:true} (no further comparison attempted)
 *   - expired     -> {ok:false, expired:true}
 *   - mismatch    -> ADD otpAttempts :1; lock at OTP_MAX_ATTEMPTS; {ok:false, attemptsLeft}
 *   - match       -> clear OTP fields, setInviteStatus("verified"), {ok:true}
 * The comparison itself uses crypto.timingSafeEqual on equal-length hex-decoded
 * buffers (both sides are fixed-length SHA-256 hex digests, so lengths always
 * match) to avoid a timing side-channel on the stored hash.
 */
export async function verifyOtp(inviteToken, code) {
  const invite = await getInvite(inviteToken);
  if (!invite) return { ok: false, notFound: true };
  if (invite.otpLocked) return { ok: false, locked: true };
  if (!invite.otpExpiresAt || now() > invite.otpExpiresAt) return { ok: false, expired: true };

  const candidateHash = Buffer.from(hashOtp(code), "hex");
  const storedHash = Buffer.from(invite.otpHash ?? "", "hex");
  const match = candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);

  if (match) {
    const db = await ddb();
    await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "REMOVE otpHash, otpExpiresAt SET otpAttempts = :zero, otpLocked = :false",
        ExpressionAttributeValues: { ":zero": N(0), ":false": BOOL(false) },
      })
    );
    await setInviteStatus(inviteToken, "verified");
    return { ok: true };
  }

  const attempts = (invite.otpAttempts ?? 0) + 1;
  const lockingNow = attempts >= OTP_MAX_ATTEMPTS;
  const db = await ddb();
  await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression: "ADD otpAttempts :one" + (lockingNow ? " SET otpLocked = :true" : ""),
      ExpressionAttributeValues: lockingNow ? { ":one": N(1), ":true": BOOL(true) } : { ":one": N(1) },
    })
  );
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
        UpdateExpression:
          "ADD booked :one SET inviteTokens = list_append(if_not_exists(inviteTokens, :empty), :it), ttl = :ttl",
        ConditionExpression: "attribute_not_exists(booked) OR booked < :cap",
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
export async function createOrder({ orgId, invoiceNo, gstin, amountMinor, currency, credits }) {
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

/** markOrderPaid(): idempotent created->paid transition — a webhook retried N
 *  times only flips status once; every retry after the first hits the condition
 *  and fails harmlessly (caller should treat ConditionalCheckFailedException here
 *  as "already handled", not an error). */
export async function markOrderPaid(orderId) {
  const db = await ddb();
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: ORDERS_TABLE,
        Key: { orderId: S(orderId) },
        UpdateExpression: "SET #s = :paid, paidAt = :now",
        ConditionExpression: "#s = :created",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":paid": S("paid"), ":created": S("created"), ":now": S(nowIso()) },
      })
    );
    return { paid: true };
  } catch (e) {
    if (e.name === "ConditionalCheckFailedException") return { paid: false }; // already paid / missing
    throw e;
  }
}
