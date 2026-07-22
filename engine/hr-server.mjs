// LOCAL DEV HR engine (no AWS). A tiny dependency-free Node HTTP server that
// implements the same /hr/* contract the production ShieldSyncHrEngine Lambda
// will serve, backed by a JSON file in the OS temp dir. Lets the HR portal run
// end-to-end on localhost before any AWS provisioning.
//
//   node engine/hr-server.mjs           # listens on :4002
//
// The Next app points at it via HR_ENGINE_URL=http://localhost:4002 and
// authenticates with x-engine-token: HR_ENGINE_SECRET (dev value below).
// NOTE: this is DEV-ONLY scaffolding; prod data lives in DynamoDB + S3 (SSE-KMS)
// via the Lambda — never this file store.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";

const PORT = Number(process.env.HR_ENGINE_PORT ?? 4002);
const SECRET = process.env.HR_ENGINE_SECRET ?? "dev-hr-engine-secret";
const DB = path.join(os.tmpdir(), "shieldsync-hr-dev-store.json");
// KYC bytes live here in dev (prod: the SSE-KMS S3 bucket). Kept OUT of the repo.
const KYC_DIR = path.join(os.tmpdir(), "shieldsync-hr-kyc");
mkdirSync(KYC_DIR, { recursive: true });

function load() {
  if (!existsSync(DB)) return { employees: [], audit: [], documents: [], seq: 7, refs: { "hr-2026": 14 } }; // next id after Diya (0007)
  try {
    return JSON.parse(readFileSync(DB, "utf8"));
  } catch {
    return { employees: [], audit: [], documents: [], seq: 7, refs: { "hr-2026": 14 } };
  }
}
function save(db) {
  writeFileSync(DB, JSON.stringify(db, null, 2));
}
const pad4 = (n) => String(n).padStart(4, "0");

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}
function audit(db, actor, action, target, detail) {
  db.audit.unshift({
    auditId: `a_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    actor: actor ?? "unknown",
    action,
    target: target ?? "",
    detail: detail ?? {},
    createdAt: new Date().toISOString(),
  });
}

// Magic-byte sniffing: never trust the client-declared content type for the
// DPDP-sensitive store. Exactly the four formats the KYC vault allows.
function sniffType(bytes) {
  if (bytes.length >= 5 && bytes.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (bytes.length >= 12 && bytes.slice(0, 4).toString("latin1") === "RIFF" && bytes.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
const KYC_KINDS = new Set(["aadhaar", "pan", "bank_proof", "photo", "signed_offer", "education", "experience", "other"]);
const MAX_KYC = 4 * 1024 * 1024; // 4 MB — matches the prod Lambda payload ceiling

// Allocate the next number in a yearly letter-reference series (atomic within
// this single-process dev server). "hr" seeds at 14 (the manual series is at
// SSS/HR/2026/014), "int" starts fresh.
function nextRef(db, series, year) {
  const key = `${series}-${year}`;
  db.refs = db.refs || {};
  if (db.refs[key] === undefined) db.refs[key] = series === "hr" && year === 2026 ? 14 : 0;
  db.refs[key] += 1;
  const prefix = series === "int" ? "SSS/INT" : "SSS/HR";
  return `${prefix}/${year}/${String(db.refs[key]).padStart(3, "0")}`;
}

const server = http.createServer(async (req, res) => {
  const urlPre = new URL(req.url, `http://localhost:${PORT}`);
  // Liveness probe — BEFORE the token gate, returns no data.
  if (urlPre.pathname === "/hr/health") return send(res, 200, { ok: true });

  // Engine-token auth (matches the prod hrFetch contract).
  if ((req.headers["x-engine-token"] ?? "") !== SECRET) {
    return send(res, 401, { error: "BAD_TOKEN" });
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // ["hr","employees",":seq"]
  const db = load();
  if (!db.documents) db.documents = [];

  try {
    // /hr/employees
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length === 2) {
      if (req.method === "GET") {
        return send(res, 200, { employees: db.employees });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const seq = (db.seq || 0) + 1;
        const now = new Date().toISOString();
        const employee = {
          ...body.employee,
          employeeId: `SSS/EMP/${pad4(seq)}`,
          seq,
          createdAt: now,
          updatedAt: now,
        };
        db.employees.push(employee);
        db.seq = seq;
        audit(db, body.actor, "employee.create", employee.employeeId, { name: employee.name });
        save(db);
        return send(res, 200, { employee });
      }
    }

    // /hr/employees/:seq
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length === 3) {
      const seq = Number(parts[2]);
      const idx = db.employees.findIndex((e) => e.seq === seq);
      if (req.method === "GET") {
        if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
        return send(res, 200, { employee: db.employees[idx] });
      }
      if (req.method === "PUT") {
        if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
        const body = await readBody(req);
        const cur = db.employees[idx];
        // Optimistic lock: with two HR users, last-write-wins silently loses
        // edits — refuse when the record changed since the form was loaded.
        if (body.expectedUpdatedAt && body.expectedUpdatedAt !== cur.updatedAt) {
          return send(res, 409, { error: "STALE", updatedAt: cur.updatedAt });
        }
        const updated = {
          ...cur,
          ...body.employee,
          seq,
          employeeId: cur.employeeId,
          // Status + LWD change ONLY via /status (an address-typo edit must
          // never silently reactivate an exited employee).
          status: cur.status ?? "active",
          lastWorkingDay: cur.lastWorkingDay,
          createdAt: cur.createdAt,
          updatedAt: new Date().toISOString(),
        };
        db.employees[idx] = updated;
        const grossChanged = cur.grossMonthly !== updated.grossMonthly;
        audit(db, body.actor, "employee.update", updated.employeeId, grossChanged ? { grossFrom: cur.grossMonthly, grossTo: updated.grossMonthly } : {});
        save(db);
        return send(res, 200, { employee: updated });
      }
      if (req.method === "DELETE") {
        if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
        const [emp] = db.employees.splice(idx, 1);
        // Cascade: remove this employee's KYC docs (metadata + bytes).
        let removedDocs = 0;
        db.documents = db.documents.filter((d) => {
          if (d.employeeSeq !== seq) return true;
          try {
            unlinkSync(path.join(KYC_DIR, d.docId));
          } catch {}
          removedDocs++;
          return false;
        });
        const body = await readBody(req);
        audit(db, body.actor, "employee.delete", emp.employeeId, { name: emp.name, removedDocs });
        save(db);
        return send(res, 200, { ok: true, removedDocs });
      }
    }

    // /hr/employees/:seq/status — offboard / reactivate (partial merge)
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "status" && parts.length === 4 && req.method === "POST") {
      const seq = Number(parts[2]);
      const idx = db.employees.findIndex((e) => e.seq === seq);
      if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
      const body = await readBody(req);
      const status = body.status === "exited" ? "exited" : "active";
      db.employees[idx] = {
        ...db.employees[idx],
        status,
        lastWorkingDay: status === "exited" ? body.lastWorkingDay || db.employees[idx].lastWorkingDay || "" : undefined,
        updatedAt: new Date().toISOString(),
      };
      audit(db, body.actor, status === "exited" ? "employee.offboard" : "employee.reactivate", db.employees[idx].employeeId, {
        lastWorkingDay: db.employees[idx].lastWorkingDay,
      });
      save(db);
      return send(res, 200, { employee: db.employees[idx] });
    }

    // /hr/employees/:seq/docs (KYC) — dev store: metadata in JSON, bytes in KYC_DIR
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "docs") {
      const seq = Number(parts[2]);

      // POST .../docs  — register + upload (base64 body)
      if (parts.length === 4 && req.method === "POST") {
        const body = await readBody(req);
        const bytes = Buffer.from(body.base64 || "", "base64");
        if (bytes.length === 0) return send(res, 400, { error: "EMPTY" });
        if (bytes.length > MAX_KYC) return send(res, 400, { error: "TOO_LARGE" });
        // Server-side magic-byte check — the declared content type is untrusted.
        const sniffed = sniffType(bytes);
        if (!sniffed) return send(res, 400, { error: "BAD_FILE_TYPE" });
        body.contentType = sniffed;
        if (!KYC_KINDS.has(body.kind)) body.kind = "other";
        const docId = `d_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        mkdirSync(KYC_DIR, { recursive: true }); // re-assert: Windows may clean %TEMP% mid-run
        writeFileSync(path.join(KYC_DIR, docId), bytes);
        const doc = {
          docId,
          employeeSeq: seq,
          category: "kyc",
          kind: body.kind || "other",
          label: body.label || "",
          fileName: body.fileName || "file",
          contentType: body.contentType || "application/octet-stream",
          sizeBytes: bytes.length,
          sha256,
          uploadedBy: body.actor || "unknown",
          uploadedAt: new Date().toISOString(),
        };
        db.documents.push(doc);
        audit(db, body.actor, "kyc.upload", `${seq}/${docId}`, { kind: doc.kind, fileName: doc.fileName });
        save(db);
        return send(res, 200, { doc });
      }

      // GET .../docs  — list KYC metadata only (never bytes, never generated docs)
      if (parts.length === 4 && req.method === "GET") {
        return send(res, 200, { docs: db.documents.filter((d) => d.employeeSeq === seq && d.category !== "generated") });
      }

      // GET .../docs/:docId/content  — stream bytes (SHA-verified), audited
      if (parts.length === 6 && parts[5] === "content" && req.method === "GET") {
        const doc = db.documents.find((d) => d.employeeSeq === seq && d.docId === parts[4]);
        const fp = doc && path.join(KYC_DIR, doc.docId);
        if (!doc || !existsSync(fp)) return send(res, 404, { error: "NOT_FOUND" });
        const bytes = readFileSync(fp);
        if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256) {
          return send(res, 500, { error: "HASH_MISMATCH" });
        }
        // Actor rides in a header (never the query string — URLs land in logs).
        audit(db, req.headers["x-hr-actor"] || url.searchParams.get("actor"), "kyc.download", `${seq}/${doc.docId}`, { fileName: doc.fileName });
        save(db);
        return send(res, 200, { contentType: doc.contentType, fileName: doc.fileName, base64: bytes.toString("base64") });
      }

      // DELETE .../docs/:docId  — remove + audit
      if (parts.length === 5 && req.method === "DELETE") {
        const idx = db.documents.findIndex((d) => d.employeeSeq === seq && d.docId === parts[4]);
        if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
        const [doc] = db.documents.splice(idx, 1);
        try {
          unlinkSync(path.join(KYC_DIR, doc.docId));
        } catch {}
        const body = await readBody(req);
        audit(db, body.actor, "kyc.delete", `${seq}/${doc.docId}`, { fileName: doc.fileName });
        save(db);
        return send(res, 200, { ok: true });
      }
    }

    // /hr/employees/:seq/generated — issued-document history (snapshot re-render)
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "generated") {
      const seq = Number(parts[2]);

      if (parts.length === 4 && req.method === "POST") {
        const body = await readBody(req);
        const genId = `g_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        // Unified reference series: when the caller asks (refSeries "hr"|"int"),
        // the REAL ref is allocated atomically here at issue time — page views
        // only preview a provisional ref and never consume a number.
        let ref = body.ref || "";
        const snapshot = body.snapshot ?? {};
        if (body.refSeries === "hr" || body.refSeries === "int") {
          ref = nextRef(db, body.refSeries, Number(body.refYear) || new Date().getFullYear());
          if (snapshot && typeof snapshot === "object") snapshot.ref = ref;
        }
        const rec = {
          docId: genId,
          employeeSeq: seq,
          category: "generated",
          docType: body.docType || "document",
          title: body.title || "",
          ref,
          snapshotVersion: 1,
          snapshotJson: JSON.stringify(snapshot),
          generatedBy: body.actor || "unknown",
          generatedAt: new Date().toISOString(),
        };
        db.documents.push(rec);
        audit(db, body.actor, "doc.generate", `${seq}/${genId}`, { docType: rec.docType, ref: rec.ref });
        save(db);
        return send(res, 200, { gen: { docId: genId, docType: rec.docType, title: rec.title, ref: rec.ref } });
      }

      if (parts.length === 4 && req.method === "GET") {
        const list = db.documents
          .filter((d) => d.employeeSeq === seq && d.category === "generated")
          .map(({ docId, docType, title, ref, generatedBy, generatedAt }) => ({ docId, docType, title, ref, generatedBy, generatedAt }))
          .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
        return send(res, 200, { generated: list });
      }

      if (parts.length === 5 && req.method === "GET") {
        const d = db.documents.find((x) => x.employeeSeq === seq && x.docId === parts[4] && x.category === "generated");
        if (!d) return send(res, 404, { error: "NOT_FOUND" });
        return send(res, 200, {
          gen: { docId: d.docId, docType: d.docType, title: d.title, ref: d.ref, generatedBy: d.generatedBy, generatedAt: d.generatedAt, snapshot: JSON.parse(d.snapshotJson || "{}") },
        });
      }
    }

    // /hr/email — send a document to an employee (Resend; simulated when no key)
    if (parts[0] === "hr" && parts[1] === "email" && parts.length === 2 && req.method === "POST") {
      const body = await readBody(req);
      const to = (body.toEmail || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return send(res, 400, { error: "BAD_EMAIL" });
      const bytes = Buffer.from(body.base64 || "", "base64");
      if (bytes.length === 0 || bytes.length > MAX_KYC) return send(res, 400, { error: bytes.length ? "TOO_LARGE" : "EMPTY" });
      if (sniffType(bytes) !== "application/pdf") return send(res, 400, { error: "PDF_ONLY" });

      const key = process.env.RESEND_API_KEY;
      let delivery = { simulated: true };
      if (key) {
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
        if (!r.ok) return send(res, 502, { error: "SEND_FAILED", status: r.status });
        delivery = { simulated: false };
      }

      // Archive the exact sent bytes as the issued artifact (category "sent").
      const seq = Number(body.employeeSeq) || 0;
      const docId = `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      mkdirSync(KYC_DIR, { recursive: true });
      writeFileSync(path.join(KYC_DIR, docId), bytes);
      db.documents.push({
        docId,
        employeeSeq: seq,
        category: "sent",
        kind: "other",
        label: `Emailed to ${to}: ${body.subject || ""}`.trim(),
        fileName: body.fileName || "document.pdf",
        contentType: "application/pdf",
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        uploadedBy: body.actor || "unknown",
        uploadedAt: new Date().toISOString(),
      });
      audit(db, body.actor, "doc.email", `${seq}/${docId}`, { to, subject: body.subject, simulated: delivery.simulated });
      save(db);
      return send(res, 200, { ok: true, ...delivery });
    }

    // /hr/audit
    if (parts[0] === "hr" && parts[1] === "audit" && parts.length === 2) {
      if (req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
        return send(res, 200, { audit: db.audit.slice(0, limit) });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        audit(db, body.actor, body.action ?? "note", body.target, body.detail);
        save(db);
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: "NO_ROUTE", path: url.pathname });
  } catch (e) {
    return send(res, 500, { error: "SERVER", message: String(e?.message ?? e) });
  }
});

server.listen(PORT, () => {
  console.log(`[hr-dev-engine] listening on http://localhost:${PORT}  (store: ${DB})`);
});
