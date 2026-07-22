// ShieldSync Enterprise — session-recording infra (webcam snapshots + mic audio).
//
// The candidate's browser captures periodic JPEG snapshots and standalone WebM
// audio chunks during a live assessment and PUTs them DIRECTLY to S3 via
// presigned URLs minted here — media never transits the Worker or the Lambda.
// The employer's candidate report lists the objects back through presigned GETs.
//
// SECURITY MODEL
//  - Object keys are SERVER-generated (rec/<assessmentId>/<token8>/<kind>/<seq>.<ext>);
//    the client chooses only kind+seq from a whitelisted, bounded space, so a
//    candidate can never write outside their own session prefix.
//  - Presigned PUTs are minted only while the invite is status "started" (a live
//    session), expire in 10 minutes, and are capped per invite (REC_PRESIGN_CAP)
//    via an atomic counter — a leaked invite link cannot be used to fill the bucket.
//  - Playback listing authenticates by candidateReportToken (the employer's
//    revocable report link), NEVER the invite token, and respects report revocation.
//  - PII erasure deletes the whole recording prefix (face images + voice are the
//    most sensitive artifacts we hold; the erase cascade must cover them first).
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

const REGION = "us-east-1";
export const REC_BUCKET = "shieldsync-ent-recordings-750294427884";
const INVITES_TABLE = "ShieldSyncEntInvites";

// Hard cap on presigned PUTs per invite. A 60-min session at the normal cadence
// is ~240 snapshots + ~240 audio chunks + 1 identity shot; the cap leaves ~3x
// headroom for retries/degrade cycles while bounding worst-case abuse.
const REC_PRESIGN_CAP = 1500;
const PUT_EXPIRY_S = 600; // 10 min — the client uploads within seconds of minting
const GET_EXPIRY_S = 3600; // 1 h — a report-viewing session

// kind -> allowed content types (each mapped to its key extension). Anything
// else is rejected. audio accepts BOTH webm/opus (Chrome/Edge/Firefox) and
// mp4/AAC (Safari's MediaRecorder output) — the client sends whichever its
// MediaRecorder actually produces.
const KINDS = {
  id: { contentTypes: { "image/jpeg": "jpg" }, maxSeq: 4 },
  snap: { contentTypes: { "image/jpeg": "jpg" }, maxSeq: 5000 },
  audio: { contentTypes: { "audio/webm": "webm", "audio/mp4": "mp4" }, maxSeq: 5000 },
};

const s3 = new S3Client({ region: REGION });
const db = new DynamoDBClient({ region: REGION });
const S = (v) => ({ S: String(v) });

// The per-invite S3 prefix. token8 (a display-safe prefix of the invite token)
// keeps full bearer tokens OUT of object keys — keys surface in S3 inventories,
// access logs and error messages, none of which may carry a live credential.
export function recPrefix(invite) {
  return `rec/${invite.assessmentId}/${String(invite.inviteToken).slice(0, 8)}/`;
}

/**
 * presignRecUploads(): mint presigned PUT URLs for a batch of capture items.
 * Caller (ent-handler) has already verified the invite exists and is "started".
 * items: [{ kind, seq }] (max 8 per call — one capture cycle is 2-3 items).
 * Returns { uploads: [{ kind, seq, url, key }] }.
 * Throws { code: "REC_CAP" } when the per-invite mint cap is exhausted.
 */
export async function presignRecUploads(invite, items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 8) {
    const err = new Error("REC_BAD_ITEMS");
    err.code = "REC_BAD_ITEMS";
    throw err;
  }
  const cleaned = items.map((it) => {
    const spec = KINDS[it?.kind];
    const seq = Number(it?.seq);
    const ext = spec?.contentTypes?.[it?.contentType];
    if (!spec || !ext || !Number.isInteger(seq) || seq < 0 || seq > spec.maxSeq) {
      const err = new Error("REC_BAD_ITEMS");
      err.code = "REC_BAD_ITEMS";
      throw err;
    }
    return { kind: it.kind, seq, contentType: it.contentType, ext };
  });

  // Atomic mint-cap: reserve the batch BEFORE signing. The condition keeps a
  // burst of parallel calls from overshooting the cap (mirrors claimOtpAttempt).
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

  const prefix = recPrefix(invite);
  const uploads = [];
  for (const { kind, seq, contentType, ext } of cleaned) {
    const key = `${prefix}${kind}/${String(seq).padStart(5, "0")}.${ext}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: REC_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: PUT_EXPIRY_S }
    );
    uploads.push({ kind, seq, url, key });
  }
  return { uploads };
}

/**
 * recordRecEvent(): append a compact status event (start/stop/gap/denied/
 * degraded/upload_failed) to the invite row — the honest coverage trail the
 * report reads ("recording paused for 4 min"). Bounded: the list_append stops
 * accepting once 80 events are stored, so a hostile client can't bloat the row.
 * Best-effort by contract — callers swallow failures.
 */
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
        ExpressionAttributeValues: {
          ":ev": { L: [S(ev)] },
          ":empty": { L: [] },
          ":max": { N: "80" },
        },
      })
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * listRecordings(): everything captured for one invite, as presigned GETs the
 * report page can put straight into <img>/<audio> tags. Single-session volume
 * (~500 objects) fits one ListObjectsV2 page; if a session somehow exceeds
 * 1000 objects we truncate rather than paginate — the report shows what fits.
 * Returns { id, snaps, audio, truncated } (id = identity shot or null).
 */
export async function listRecordings(invite) {
  const prefix = recPrefix(invite);
  const r = await s3.send(
    new ListObjectsV2Command({ Bucket: REC_BUCKET, Prefix: prefix, MaxKeys: 1000 })
  );
  const objects = r.Contents ?? [];
  const out = { id: null, snaps: [], audio: [], truncated: !!r.IsTruncated };
  for (const o of objects) {
    const rel = o.Key.slice(prefix.length); // "<kind>/<seq>.<ext>"
    const [kind, file] = rel.split("/");
    if (!KINDS[kind] || !file) continue;
    const seq = Number.parseInt(file, 10);
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: REC_BUCKET, Key: o.Key }),
      { expiresIn: GET_EXPIRY_S }
    );
    const entry = { seq: Number.isFinite(seq) ? seq : 0, url, size: o.Size ?? 0, at: o.LastModified?.toISOString?.() ?? null };
    if (kind === "id") {
      if (!out.id || entry.seq < out.id.seq) out.id = entry;
    } else if (kind === "snap") out.snaps.push(entry);
    else out.audio.push(entry);
  }
  out.snaps.sort((a, b) => a.seq - b.seq);
  out.audio.sort((a, b) => a.seq - b.seq);
  return out;
}

/**
 * deleteRecordings(): erase-cascade hook — delete every object under the
 * invite's recording prefix (face images + voice audio). Paginates fully:
 * an erasure request must never leave media behind because of a page limit.
 * Returns { deleted } (count). Throws on S3 errors — the caller decides
 * whether erasure may proceed without media deletion (it logs and continues,
 * since the DDB redaction must not be rolled back by an S3 blip).
 */
export async function deleteRecordings(invite) {
  const prefix = recPrefix(invite);
  let deleted = 0;
  let token = undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: REC_BUCKET,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: token,
      })
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({ Bucket: REC_BUCKET, Delete: { Objects: keys, Quiet: true } })
      );
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { deleted };
}
