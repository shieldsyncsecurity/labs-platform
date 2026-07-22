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
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const ACCOUNT = process.env.PLATFORM_ACCOUNT ?? "750294427884";
const T_EMP = "ShieldSyncHrEmployees";
const T_DOC = "ShieldSyncHrDocuments";
const T_AUDIT = "ShieldSyncHrAudit";
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

export async function handler(event) {
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
        const out = await ddb.send(new ScanCommand({ TableName: T_EMP }));
        // seq <= 0 rows are counters (0 = employee ids; negatives = letter-ref series).
        const employees = (out.Items ?? []).filter((i) => i.seq > 0).sort((a, b) => a.seq - b.seq);
        return resp(200, { employees });
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
        return resp(200, { employee });
      }
    }

    // ---- /hr/employees/:seq ----
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length === 3) {
      const seq = Number(parts[2]);
      if (method === "GET") {
        const out = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
        if (!out.Item) return resp(404, { error: "NOT_FOUND" });
        return resp(200, { employee: out.Item });
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
        return resp(200, { employee });
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
      const cur = await ddb.send(new GetCommand({ TableName: T_EMP, Key: { seq } }));
      if (!cur.Item) return resp(404, { error: "NOT_FOUND" });
      const status = body.status === "exited" ? "exited" : "active";
      const employee = {
        ...cur.Item,
        status,
        lastWorkingDay: status === "exited" ? body.lastWorkingDay || cur.Item.lastWorkingDay || "" : undefined,
        updatedAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: T_EMP, Item: employee }));
      await writeAudit(body.actor, status === "exited" ? "employee.offboard" : "employee.reactivate", employee.employeeId, { lastWorkingDay: employee.lastWorkingDay });
      return resp(200, { employee });
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
          .map(({ docId, docType, title, ref, generatedBy, generatedAt }) => ({ docId, docType, title, ref, generatedBy, generatedAt }))
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

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
          to: [to],
          subject: body.subject || "Document from ShieldSync HR",
          text: body.bodyText || "Please find the attached document.\n\n— ShieldSync Security Private Limited (HR)",
          attachments: [{ filename: body.fileName || "document.pdf", content: bytes.toString("base64") }],
        }),
      });
      if (!r.ok) {
        console.error("[hr] Resend send failed", r.status);
        return resp(502, { error: "SEND_FAILED", status: r.status });
      }

      // Archive the exact sent bytes as the issued artifact (category "sent").
      const seqNum = Number(body.employeeSeq) || 0;
      const docId = `s_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const s3key = `emp/${seqNum}/${docId}`;
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
      await writeAudit(body.actor, "doc.email", `${seqNum}/${docId}`, { to, subject: body.subject });
      return resp(200, { ok: true, simulated: false });
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
