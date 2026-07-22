// ShieldSync Enterprise — session-recording infra (webcam snapshots + mic audio).
//
// The candidate's browser captures periodic JPEG snapshots and standalone WebM/
// MP4 audio chunks during a live assessment and PUTs them DIRECTLY to S3 via
// presigned URLs minted here — media never transits the Worker or the Lambda.
// The employer's candidate report lists the objects back through presigned GETs.
//
// SECURITY MODEL (this is a proctoring product — the CANDIDATE is the adversary):
//  - Object keys are SERVER-generated:
//        rec/<assessmentId>/<tokHash>/e<epoch>/<kind>/<seq>.<ext>
//    tokHash = sha256(inviteToken)[:16] so the full bearer token never appears
//    in keys/logs/inventories, and two candidates cannot collide on a short prefix.
//  - CAPTURE EPOCHS make evidence tamper-evident: startRecEpoch() atomically
//    increments a per-invite counter; presigns are ONLY ever signed for the
//    CURRENT epoch. A page reload starts a NEW epoch (new key space), so a
//    candidate can never overwrite the earlier half of their own recording (or
//    the identity shot) — a hand-off after identity check shows as a NEW epoch
//    in the report instead of silently replacing the first one.
//  - Each presign is signed with an EXACT ContentLength (the client's real blob
//    size, validated <= a per-kind byte cap), so S3 rejects a PUT that does not
//    send exactly that many bytes — a leaked URL cannot be used to upload a
//    multi-GB body, and the per-invite mint cap bounds object count.
//  - Presigns are minted only while the invite is a live, non-erased session
//    (lifecycle gate enforced by the caller in ent-handler).
//  - Playback listing authenticates by candidateReportToken (the employer's
//    revocable report link), NEVER the invite token, and respects revocation.
//  - PII erasure deletes the whole recording prefix AND verifies the delete
//    (per-key errors surface, so a silent partial erasure of biometric media
//    cannot pass as complete).
//
// The @aws-sdk clients + the presigner are provided by the Lambda nodejs runtime.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

const REGION = "us-east-1";
export const REC_BUCKET = "shieldsync-ent-recordings-750294427884";
const INVITES_TABLE = "ShieldSyncEntInvites";

// Hard cap on presigned PUTs per invite (across ALL epochs). A 60-min session
// at the normal cadence is ~240 snapshots + ~240 audio + 1 identity shot; the
// cap leaves headroom for retries/degrade/reconnect while bounding abuse.
const REC_PRESIGN_CAP = 1500;
const PUT_EXPIRY_S = 600; // 10 min — the client uploads within seconds of minting
const GET_EXPIRY_S = 3600; // 1 h — a report-viewing session (client re-fetches on expiry)

// kind -> { contentTypes: {mime: ext}, maxSeq, maxBytes }. maxBytes is the
// S3-ENFORCED per-object ceiling (signed as ContentLength). Generous vs. real
// captures (a snapshot is ~30-120 KB, a 30s opus chunk ~120 KB) but bounds abuse.
const KINDS = {
  id: { contentTypes: { "image/jpeg": "jpg" }, maxSeq: 4, maxBytes: 4_000_000 },
  snap: { contentTypes: { "image/jpeg": "jpg" }, maxSeq: 5000, maxBytes: 3_000_000 },
  audio: { contentTypes: { "audio/webm": "webm", "audio/mp4": "mp4" }, maxSeq: 5000, maxBytes: 5_000_000 },
};

const s3 = new S3Client({ region: REGION });
const db = new DynamoDBClient({ region: REGION });
const S = (v) => ({ S: String(v) });

// Per-invite S3 prefix. sha256(inviteToken)[:16] — the full bearer token must
// never appear in an object key (keys leak into inventories, access logs and
// errors). 64 bits of namespace makes a cross-candidate collision infeasible.
export function recPrefix(invite) {
  const h = createHash("sha256").update(String(invite.inviteToken)).digest("hex").slice(0, 16);
  return `rec/${invite.assessmentId}/${h}/`;
}

/**
 * startRecEpoch(): atomically allocate the next capture epoch for a live
 * session. Each recorder instance (fresh page load included) calls this once;
 * the returned epoch namespaces its object keys so it can NEVER overwrite an
 * earlier epoch's evidence. Monotonic — only ever increases. The caller has
 * already enforced the lifecycle gate (started + not erased). Returns { epoch }.
 */
export async function startRecEpoch(inviteToken) {
  const r = await db.send(
    new UpdateItemCommand({
      TableName: INVITES_TABLE,
      Key: { inviteToken: S(inviteToken) },
      UpdateExpression: "ADD recEpoch :one",
      ExpressionAttributeValues: { ":one": { N: "1" } },
      ReturnValues: "UPDATED_NEW",
    })
  );
  return { epoch: Number(r.Attributes?.recEpoch?.N ?? "1") };
}

/**
 * presignRecUploads(): mint presigned PUT URLs for a batch of capture items.
 * Caller (ent-handler) has verified the invite exists and is a writable session.
 * `epoch` MUST equal the invite's current recEpoch (a stale reloaded instance is
 * rejected). items: [{ kind, seq, contentType, size }] (max 8 per call).
 * Returns { uploads: [{ kind, seq, url, key }] }.
 * Throws { code } — REC_BAD_ITEMS | REC_STALE_EPOCH | REC_CAP.
 */
export async function presignRecUploads(invite, epoch, items) {
  const current = Number(invite.recEpoch ?? 0);
  const ep = Number(epoch);
  if (!Number.isInteger(ep) || ep < 1 || ep !== current) {
    const err = new Error("REC_STALE_EPOCH");
    err.code = "REC_STALE_EPOCH";
    throw err;
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 8) {
    const err = new Error("REC_BAD_ITEMS");
    err.code = "REC_BAD_ITEMS";
    throw err;
  }
  const cleaned = items.map((it) => {
    const spec = KINDS[it?.kind];
    const seq = Number(it?.seq);
    const size = Number(it?.size);
    const ext = spec?.contentTypes?.[it?.contentType];
    if (
      !spec || !ext ||
      !Number.isInteger(seq) || seq < 0 || seq > spec.maxSeq ||
      !Number.isInteger(size) || size <= 0 || size > spec.maxBytes
    ) {
      const err = new Error("REC_BAD_ITEMS");
      err.code = "REC_BAD_ITEMS";
      throw err;
    }
    return { kind: it.kind, seq, contentType: it.contentType, ext, size };
  });

  // Atomic mint-cap: reserve the batch BEFORE signing so a burst of parallel
  // calls cannot overshoot the cap (mirrors claimOtpAttempt).
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(invite.inviteToken) },
        UpdateExpression: "ADD recPresignCount :n",
        ConditionExpression: "attribute_not_exists(recPresignCount) OR recPresignCount < :cap",
        ExpressionAttributeValues: {
          ":n": { N: String(cleaned.length) },
          ":cap": { N: String(REC_PRESIGN_CAP) },
        },
      })
    );
  } catch (e) {
    if (e?.name === "ConditionalCheckFailedException") {
      const err = new Error("REC_CAP");
      err.code = "REC_CAP";
      throw err;
    }
    throw e;
  }

  const prefix = `${recPrefix(invite)}e${ep}/`;
  const uploads = [];
  for (const { kind, seq, contentType, ext, size } of cleaned) {
    const key = `${prefix}${kind}/${String(seq).padStart(5, "0")}.${ext}`;
    // Signing ContentLength binds the PUT to EXACTLY `size` bytes — S3 rejects
    // any other body length, so a leaked URL can't upload a giant object.
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: REC_BUCKET, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn: PUT_EXPIRY_S }
    );
    uploads.push({ kind, seq, url, key });
  }
  return { uploads };
}

// Compact status events (start/stop/gap/resume/denied/degraded/upload_failed):
// the honest coverage trail the report reads. Bounded to 120 entries so a
// hostile client can't bloat the invite row.
const REC_EVENT_TYPES = new Set(["start", "stop", "gap", "resume", "denied", "degraded", "upload_failed"]);
export async function recordRecEvent(inviteToken, type) {
  if (!REC_EVENT_TYPES.has(type)) return { ok: false };
  const ev = JSON.stringify({ t: type, at: new Date().toISOString() });
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: INVITES_TABLE,
        Key: { inviteToken: S(inviteToken) },
        UpdateExpression: "SET recEvents = list_append(if_not_exists(recEvents, :empty), :ev)",
        ConditionExpression: "attribute_not_exists(recEvents) OR size(recEvents) < :max",
        ExpressionAttributeValues: { ":ev": { L: [S(ev)] }, ":empty": { L: [] }, ":max": { N: "120" } },
      })
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * listRecordings(): everything captured for one invite across ALL epochs, as
 * presigned GETs the report can put into <img>/<audio> tags. Merges epochs in
 * time order (each epoch = one capture session; >1 means the candidate reloaded
 * / re-entered, which the report surfaces rather than hides). ~500 objects fit
 * one page; beyond 1000 we truncate rather than paginate.
 * Returns { id, snaps, audio, epochCount, truncated }.
 */
export async function listRecordings(invite) {
  const prefix = recPrefix(invite);
  const r = await s3.send(
    new ListObjectsV2Command({ Bucket: REC_BUCKET, Prefix: prefix, MaxKeys: 1000 })
  );
  const objects = r.Contents ?? [];
  const epochs = new Set();
  const ids = []; // one per epoch
  const snaps = [];
  const audio = [];
  for (const o of objects) {
    const rel = o.Key.slice(prefix.length); // "e<epoch>/<kind>/<seq>.<ext>"
    const m = rel.match(/^e(\d+)\/(id|snap|audio)\/(\d+)\./);
    if (!m) continue;
    const epoch = Number(m[1]);
    const kind = m[2];
    const seq = Number(m[3]);
    epochs.add(epoch);
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: REC_BUCKET, Key: o.Key }),
      { expiresIn: GET_EXPIRY_S }
    );
    const entry = { epoch, seq, url, size: o.Size ?? 0, at: o.LastModified?.toISOString?.() ?? null };
    if (kind === "id") ids.push(entry);
    else if (kind === "snap") snaps.push(entry);
    else audio.push(entry);
  }
  const byTime = (a, b) => (a.epoch - b.epoch) || (a.seq - b.seq);
  snaps.sort(byTime);
  audio.sort(byTime);
  ids.sort(byTime);
  // Identity anchor = the FIRST epoch's shot (the genuine session start; a
  // reload cannot overwrite it). Extra ids (re-entries) ride in `reentryIds`.
  return {
    id: ids[0] ?? null,
    reentryIds: ids.slice(1),
    snaps,
    audio,
    epochCount: epochs.size,
    truncated: !!r.IsTruncated,
  };
}

/**
 * deleteRecordings(): erase-cascade hook — delete every object under the
 * invite's recording prefix (face images + voice audio). Paginates fully and
 * INSPECTS the per-key delete results: S3 DeleteObjects returns HTTP 200 even
 * when individual keys fail (permission drift, transient InternalError), so a
 * silent partial erasure of biometric PII must never pass as complete.
 * Returns { deleted, failed, errors } — the caller records failed>0 in the
 * audit line and treats erasure as incomplete (must re-run).
 */
export async function deleteRecordings(invite) {
  const prefix = recPrefix(invite);
  let deleted = 0;
  let failed = 0;
  const errors = [];
  let token = undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: REC_BUCKET, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token })
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length > 0) {
      // Quiet:false so per-key failures come back in Errors (Deleted lists successes).
      const res = await s3.send(
        new DeleteObjectsCommand({ Bucket: REC_BUCKET, Delete: { Objects: keys, Quiet: false } })
      );
      deleted += res.Deleted?.length ?? 0;
      if (res.Errors?.length) {
        failed += res.Errors.length;
        for (const e of res.Errors.slice(0, 5)) errors.push(`${e.Code}:${e.Key}`);
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { deleted, failed, errors };
}
