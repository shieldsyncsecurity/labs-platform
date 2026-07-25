// LOCAL DEV HR engine (no AWS). A tiny dependency-free Node HTTP server that
// implements the same /hr/* contract the production ShieldSyncHrEngine Lambda
// will serve, backed by a JSON file INSIDE THE REPO. Lets the HR portal run
// end-to-end on localhost before any AWS provisioning.
//
//   node engine/hr-server.mjs           # listens on :4002
//
// The Next app points at it via HR_ENGINE_URL=http://localhost:4002 and
// authenticates with x-engine-token: HR_ENGINE_SECRET (dev value below).
// NOTE: this is DEV-ONLY scaffolding; prod data lives in DynamoDB + S3 (SSE-KMS)
// via the Lambda — never this file store.
//
// STORAGE LOCATION: deliberately NOT os.tmpdir() — Windows periodically wipes
// %TEMP%, which silently destroyed a real candidate's data once (2026-07-24).
// Everything dev-only lives under engine/.dev-data/ instead, which persists
// across reboots and %TEMP% cleanups. It's git-ignored (see .gitignore) so it
// never gets committed, but it survives on disk like any other project file.

import http from "node:http";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.HR_ENGINE_PORT ?? 4002);
const SECRET = process.env.HR_ENGINE_SECRET ?? "dev-hr-engine-secret";
// Overridable so the E2E suite can run against a throwaway directory instead of
// the developer's working data — a test that wipes your real dev store to prove
// a point is a test nobody runs twice.
const DEV_DATA_DIR = process.env.HR_DEV_DATA_DIR || path.join(import.meta.dirname, ".dev-data");
mkdirSync(DEV_DATA_DIR, { recursive: true });
const DB = path.join(DEV_DATA_DIR, "hr-dev-store.json");
// KYC bytes live here in dev (prod: the SSE-KMS S3 bucket). Kept OUT of git
// via .gitignore, but IN the project folder so it isn't at the mercy of OS
// temp-cleanup.
const KYC_DIR = path.join(DEV_DATA_DIR, "kyc");
mkdirSync(KYC_DIR, { recursive: true });
// Simulated emails (no RESEND_API_KEY) are written here as .html so you can
// open and preview exactly what the recipient would receive.
const MAIL_DIR = path.join(DEV_DATA_DIR, "mail");

const EMPTY_DB = { employees: [], audit: [], documents: [], candidates: [], banking: [], grants: {}, seq: 7, candidateSeq: 0, refs: { "hr-2026": 14 } }; // next id after Diya (0007)
function load() {
  if (!existsSync(DB)) return { ...EMPTY_DB };
  try {
    return { ...EMPTY_DB, ...JSON.parse(readFileSync(DB, "utf8")) };
  } catch {
    return { ...EMPTY_DB };
  }
}

// --- questionnaire-link primitives (mirrored in the prod Lambda) ---
const randomToken = () => randomBytes(24).toString("hex"); // 192-bit, unguessable
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a), "hex");
  const bb = Buffer.from(String(b), "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
/** What the PUBLIC token surface may return — never the whole record. */
function publicCandidate(c) {
  return {
    name: c.name,
    roleAppliedFor: c.roleAppliedFor,
    questionnaireRole: c.questionnaireRole,
    submittedAt: c.submittedAt,
    answers: c.submittedAt ? c.answers : undefined,
    // Filename only — so the form can show "uploaded ✓" if they come back.
    salaryProofName: c.salaryProof?.fileName,
    expiresAt: c.tokenExpiresAt,
    // If the HR user tailored the questionnaire for this candidate, the
    // public page uses that snapshot instead of loading the default from code.
    customQuestionnaire: c.customQuestionnaire,
  };
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

    // Positive-integer seq guard (parity with the Lambda's counter protection).
    if (parts[0] === "hr" && parts[1] === "employees" && parts.length >= 3) {
      const s = Number(parts[2]);
      if (!Number.isInteger(s) || s <= 0) return send(res, 404, { error: "NOT_FOUND" });
    }

    // /hr/employees/:seq/status — offboard / reactivate (touches ONLY these fields)
    if (parts[0] === "hr" && parts[1] === "employees" && parts[3] === "status" && parts.length === 4 && req.method === "POST") {
      const seq = Number(parts[2]);
      const idx = db.employees.findIndex((e) => e.seq === seq);
      if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
      const body = await readBody(req);
      const status = body.status === "exited" ? "exited" : "active";
      const cur = db.employees[idx];
      cur.status = status;
      if (status === "exited") cur.lastWorkingDay = body.lastWorkingDay || "";
      else delete cur.lastWorkingDay;
      cur.updatedAt = new Date().toISOString();
      db.employees[idx] = cur;
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

      // Withdraw an issued document (mirrors the prod Lambda) — audited WITH
      // the ref so a gap in the series is always traceable to a decision.
      if (parts.length === 5 && req.method === "DELETE") {
        const body = await readBody(req);
        const i = db.documents.findIndex((x) => x.employeeSeq === seq && x.docId === parts[4] && x.category === "generated");
        if (i < 0) return send(res, 404, { error: "NOT_FOUND" });
        const d = db.documents[i];
        db.documents.splice(i, 1);
        audit(db, body.actor, "doc.delete", `${seq}/${parts[4]}`, { docType: d.docType, ref: d.ref, title: d.title });
        save(db);
        return send(res, 200, { ok: true });
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

    // ---------------- CANDIDATES (hiring records — NOT employees) ----------------
    // /hr/candidates
    if (parts[0] === "hr" && parts[1] === "candidates" && parts.length === 2) {
      if (req.method === "GET") return send(res, 200, { candidates: db.candidates });
      if (req.method === "POST") {
        const body = await readBody(req);
        const seq = (db.candidateSeq || 0) + 1;
        const now = new Date().toISOString();
        const candidate = {
          ...body.candidate,
          candidateId: `SSS/CAND/${String(seq).padStart(4, "0")}`,
          seq,
          createdAt: now,
          updatedAt: now,
        };
        db.candidates.push(candidate);
        db.candidateSeq = seq;
        audit(db, body.actor, "candidate.create", candidate.candidateId, { name: candidate.name, role: candidate.roleAppliedFor });
        save(db);
        return send(res, 200, { candidate });
      }
    }

    // /hr/candidates/:seq  (+ /token, /submit)
    if (parts[0] === "hr" && parts[1] === "candidates" && parts.length >= 3) {
      const seq = Number(parts[2]);
      if (!Number.isInteger(seq) || seq <= 0) return send(res, 404, { error: "NOT_FOUND" });
      const idx = db.candidates.findIndex((c) => c.seq === seq);
      if (idx < 0) return send(res, 404, { error: "NOT_FOUND" });
      const cur = db.candidates[idx];

      if (parts.length === 3 && req.method === "GET") return send(res, 200, { candidate: cur });

      if (parts.length === 3 && req.method === "PUT") {
        const body = await readBody(req);
        // Token/submission state is engine-owned — a form PUT can never forge it.
        const updated = {
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
        db.candidates[idx] = updated;
        audit(db, body.actor, "candidate.update", updated.candidateId, { outcome: updated.outcome });
        save(db);
        return send(res, 200, { candidate: updated });
      }

      if (parts.length === 3 && req.method === "DELETE") {
        const body = await readBody(req);
        // Erasure must take the uploaded bytes with it — the form promises it.
        if (cur.salaryProof) {
          try {
            unlinkSync(path.join(KYC_DIR, cur.salaryProof.docId));
          } catch {}
        }
        db.candidates.splice(idx, 1);
        audit(db, body.actor, "candidate.delete", cur.candidateId, { name: cur.name, removedProof: Boolean(cur.salaryProof) });
        save(db);
        return send(res, 200, { ok: true });
      }

      // /hr/candidates/:seq/proof — HR-side download of the salary proof.
      if (parts[3] === "proof" && parts.length === 4 && req.method === "GET") {
        if (!cur.salaryProof) return send(res, 404, { error: "NOT_FOUND" });
        let bytes;
        try {
          bytes = readFileSync(path.join(KYC_DIR, cur.salaryProof.docId));
        } catch {
          return send(res, 404, { error: "NOT_FOUND" });
        }
        audit(db, url.searchParams.get("actor") ?? "unknown", "candidate.proof.download", cur.candidateId, { fileName: cur.salaryProof.fileName });
        save(db);
        return send(res, 200, { ...cur.salaryProof, base64: bytes.toString("base64") });
      }

      // /hr/candidates/:seq/token — issue (or re-issue) the questionnaire link.
      if (parts[3] === "token" && parts.length === 4 && req.method === "POST") {
        const body = await readBody(req);
        const secret = randomToken();
        const now = new Date();
        const expires = new Date(now.getTime() + (Number(body.validDays) || 14) * 86400000);
        cur.tokenHash = sha256hex(secret);
        cur.tokenIssuedAt = now.toISOString();
        cur.tokenExpiresAt = expires.toISOString();
        cur.updatedAt = now.toISOString();
        db.candidates[idx] = cur;
        audit(db, body.actor, "candidate.link", cur.candidateId, { expiresAt: cur.tokenExpiresAt });
        save(db);
        // The RAW token is returned exactly once — only its hash is stored.
        return send(res, 200, { token: `${seq}.${secret}`, expiresAt: cur.tokenExpiresAt });
      }

      // ---- /hr/candidates/:seq/token DELETE — kill a link already sent ----
      // Deletes the hash rather than back-dating the expiry, so a revoked link
      // is indistinguishable from an expired one and no token can match it.
      // Submitted answers are deliberately untouched.
      if (parts[3] === "token" && parts.length === 4 && req.method === "DELETE") {
        const body = await readBody(req);
        delete cur.tokenHash;
        delete cur.tokenIssuedAt;
        delete cur.tokenExpiresAt;
        cur.updatedAt = new Date().toISOString();
        db.candidates[idx] = cur;
        audit(db, body.actor, "candidate.link.revoke", cur.candidateId, {
          hadSubmitted: Boolean(cur.submittedAt),
          sentTo: cur.questionnaireSentTo ?? null,
        });
        save(db);
        return send(res, 200, { ok: true });
      }

      // ---- /hr/candidates/:seq/interviews — mirrors the Lambda ----
      if (parts[3] === "interviews" && parts.length === 4 && req.method === "POST") {
        const body = await readBody(req);
        const iv = {
          id: `iv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
          createdAt: new Date().toISOString(),
          createdBy: body.actor || "unknown",
          ...body.interview,
        };
        cur.interviews = [...(cur.interviews ?? []), iv].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
        cur.updatedAt = new Date().toISOString();
        db.candidates[idx] = cur;
        audit(db, body.actor, "interview.schedule", cur.candidateId, {
          startsAt: iv.startsAt,
          invited: Boolean(iv.invitedAt),
          hasMeeting: Boolean(iv.meetingUrl),
        });
        save(db);
        return send(res, 200, { interview: iv, interviews: cur.interviews });
      }

      if (parts[3] === "interviews" && parts.length === 5 && req.method === "DELETE") {
        const body = await readBody(req);
        const gone = (cur.interviews ?? []).find((x) => x.id === parts[4]);
        if (!gone) return send(res, 404, { error: "NOT_FOUND" });
        cur.interviews = (cur.interviews ?? []).filter((x) => x.id !== parts[4]);
        cur.updatedAt = new Date().toISOString();
        db.candidates[idx] = cur;
        audit(db, body.actor, "interview.cancel", cur.candidateId, { startsAt: gone.startsAt });
        save(db);
        return send(res, 200, { interviews: cur.interviews });
      }

      if (parts[3] === "sent" && parts.length === 4 && req.method === "POST") {
        const body = await readBody(req);
        cur.questionnaireSentTo = body.to;
        cur.questionnaireSentAt = new Date().toISOString();
        cur.updatedAt = cur.questionnaireSentAt;
        db.candidates[idx] = cur;
        save(db);
        return send(res, 200, { ok: true });
      }
    }

    // /hr/questionnaire/:token  — PUBLIC surface (candidate). GET = view, POST = submit.
    if (parts[0] === "hr" && parts[1] === "questionnaire" && (parts.length === 3 || parts.length === 4)) {
      const raw = decodeURIComponent(parts[2]);
      const [seqStr, secret] = raw.split(".");
      const seq = Number(seqStr);
      if (!Number.isInteger(seq) || seq <= 0 || !secret) return send(res, 404, { error: "BAD_TOKEN" });
      const idx = db.candidates.findIndex((c) => c.seq === seq);
      if (idx < 0) return send(res, 404, { error: "BAD_TOKEN" });
      const cand = db.candidates[idx];
      if (!cand.tokenHash || !timingSafeEqualHex(cand.tokenHash, sha256hex(secret))) return send(res, 404, { error: "BAD_TOKEN" });
      if (cand.tokenExpiresAt && new Date(cand.tokenExpiresAt) < new Date()) return send(res, 410, { error: "EXPIRED" });

      if (req.method === "GET") {
        // ?preview=1 = an authenticated HR user checking their own link; it must
        // never look like the candidate arriving. Mirrors the Lambda.
        if (url.searchParams.get("preview") === "1") {
          audit(db, "hr-preview", "questionnaire.preview", cand.candidateId, {});
          save(db);
          return send(res, 200, { candidate: publicCandidate(cand) });
        }
        const now = new Date().toISOString();
        cand.firstViewedAt = cand.firstViewedAt ?? now;
        cand.lastViewedAt = now;
        cand.viewCount = (cand.viewCount ?? 0) + 1;
        db.candidates[idx] = cand;
        audit(db, "candidate", "questionnaire.view", cand.candidateId, {});
        save(db);
        return send(res, 200, { candidate: publicCandidate(cand) });
      }
      // /hr/questionnaire/:token/upload — candidate's salary proof (one file).
      // Same defences as the KYC vault: magic-byte sniffing (never trust the
      // declared type), hard size cap, and it stops once they've submitted.
      if (parts.length === 4 && parts[3] === "upload") {
        if (cand.submittedAt) return send(res, 409, { error: "ALREADY_SUBMITTED" });
        if (req.method === "POST") {
          const body = await readBody(req);
          const bytes = Buffer.from(body.base64 || "", "base64");
          if (bytes.length === 0) return send(res, 400, { error: "EMPTY" });
          if (bytes.length > MAX_KYC) return send(res, 400, { error: "TOO_LARGE" });
          const sniffed = sniffType(bytes);
          if (!sniffed) return send(res, 400, { error: "BAD_TYPE" });
          // One file per candidate: replace any previous upload.
          if (cand.salaryProof) {
            try {
              unlinkSync(path.join(KYC_DIR, cand.salaryProof.docId));
            } catch {}
          }
          const docId = `cand_${seq}_${Date.now()}`;
          mkdirSync(KYC_DIR, { recursive: true });
          writeFileSync(path.join(KYC_DIR, docId), bytes);
          cand.salaryProof = {
            docId,
            fileName: String(body.fileName || "document").slice(0, 120),
            contentType: sniffed,
            sizeBytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
            uploadedAt: new Date().toISOString(),
          };
          cand.updatedAt = cand.salaryProof.uploadedAt;
          db.candidates[idx] = cand;
          audit(db, "candidate", "questionnaire.upload", cand.candidateId, { fileName: cand.salaryProof.fileName, bytes: bytes.length });
          save(db);
          return send(res, 200, { salaryProofName: cand.salaryProof.fileName });
        }
        if (req.method === "DELETE") {
          if (cand.salaryProof) {
            try {
              unlinkSync(path.join(KYC_DIR, cand.salaryProof.docId));
            } catch {}
            delete cand.salaryProof;
            cand.updatedAt = new Date().toISOString();
            db.candidates[idx] = cand;
            audit(db, "candidate", "questionnaire.upload.remove", cand.candidateId, {});
            save(db);
          }
          return send(res, 200, { ok: true });
        }
      }

      if (req.method === "POST") {
        if (cand.submittedAt) return send(res, 409, { error: "ALREADY_SUBMITTED" });
        const body = await readBody(req);
        cand.answers = body.answers ?? {};
        cand.submittedAt = new Date().toISOString();
        cand.updatedAt = cand.submittedAt;
        db.candidates[idx] = cand;
        audit(db, "candidate", "questionnaire.submit", cand.candidateId, { fields: Object.keys(cand.answers).length });
        // Prod emails the owner the answers here (notifySubmission in the
        // Lambda). Dev has no mail transport, so log it instead — the point is
        // that a dev run behaves observably the same way.
        console.log(`[hr-dev-engine] would email submission for ${cand.candidateId} to ${process.env.HR_SUBMISSION_TO || process.env.HR_REMINDER_TO || "(HR_SUBMISSION_TO unset)"}`);
        save(db);
        return send(res, 200, { candidate: publicCandidate(cand) });
      }
    }

    // /hr/notify — plain HTML email (no attachment): questionnaire invites etc.
    if (parts[0] === "hr" && parts[1] === "notify" && parts.length === 2 && req.method === "POST") {
      const body = await readBody(req);
      const to = (body.toEmail || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return send(res, 400, { error: "BAD_EMAIL" });
      const key = process.env.RESEND_API_KEY;
      let delivery = { simulated: true };
      if (key) {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: process.env.HR_MAIL_FROM || "ShieldSync HR <hr@shieldsyncsecurity.com>",
            to: [to],
            subject: body.subject || "ShieldSync Security",
            html: body.html,
            text: body.text,
          }),
        });
        if (!r.ok) return send(res, 502, { error: "SEND_FAILED", status: r.status });
        delivery = { simulated: false };
      } else {
        // DEV ONLY: write the simulated email to disk so you can open it and
        // see exactly what the recipient would get. Prod never reaches here.
        const file = path.join(MAIL_DIR, `${Date.now()}-${to.replace(/[^a-z0-9]/gi, "_")}.html`);
        mkdirSync(MAIL_DIR, { recursive: true });
        writeFileSync(
          file,
          `<!doctype html><meta charset="utf-8"><title>${body.subject ?? ""}</title>` +
            `<div style="font:13px system-ui;background:#eef2f8;padding:10px 14px;border-bottom:1px solid #ccd5e4">` +
            `<b>SIMULATED</b> — To: ${to} · Subject: ${body.subject ?? ""}</div>` +
            (body.html ?? `<pre>${body.text ?? ""}</pre>`),
        );
        console.log(`[hr-dev-engine] SIMULATED email to ${to}: ${body.subject}\n  preview: ${file}`);
      }
      audit(db, body.actor, body.action || "candidate.email", body.target || "", { to, subject: body.subject, simulated: delivery.simulated });
      save(db);
      return send(res, 200, { ok: true, ...delivery });
    }

    // ---------------- BANKING (imported bank statement transactions) ----------------
    if (parts[0] === "hr" && parts[1] === "banking" && parts.length === 2) {
      if (req.method === "GET") {
        const month = url.searchParams.get("month");
        const list = (db.banking || []).filter((t) => !month || t.month === month);
        list.sort((a, b) => (a.date === b.date ? b.balance - a.balance : a.date < b.date ? 1 : -1));
        return send(res, 200, { transactions: list });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const txns = Array.isArray(body.transactions) ? body.transactions : [];
        if (!txns.length) return send(res, 400, { error: "NO_TRANSACTIONS" });
        db.banking = db.banking || [];
        const now = new Date().toISOString();
        let created = 0;
        let updated = 0;
        for (const t of txns) {
          if (!t?.txnId || !t?.date) continue;
          const i = db.banking.findIndex((x) => x.txnId === t.txnId);
          if (i >= 0) {
            const prev = db.banking[i];
            // Keep a category the user set by hand — a re-import must not undo it.
            db.banking[i] = {
              ...t,
              category: prev.categorySetBy === "user" ? prev.category : t.category,
              categorySetBy: prev.categorySetBy,
              note: prev.note ?? t.note,
              importedAt: prev.importedAt ?? now,
              importedBy: prev.importedBy ?? body.actor,
              updatedAt: now,
            };
            updated += 1;
          } else {
            db.banking.push({ ...t, importedAt: now, importedBy: body.actor, updatedAt: now });
            created += 1;
          }
        }
        audit(db, body.actor, "banking.import", body.accountNumber ?? "", { created, updated, total: txns.length });
        save(db);
        return send(res, 200, { ok: true, created, updated });
      }
    }

    // /hr/banking/:txnId
    if (parts[0] === "hr" && parts[1] === "banking" && parts.length === 3) {
      const txnId = decodeURIComponent(parts[2]);
      db.banking = db.banking || [];
      const i = db.banking.findIndex((x) => x.txnId === txnId);
      if (i < 0) return send(res, 404, { error: "NOT_FOUND" });

      if (req.method === "PUT") {
        const body = await readBody(req);
        const cur = db.banking[i];
        db.banking[i] = {
          ...cur,
          category: body.category ?? cur.category,
          note: body.note !== undefined ? body.note : cur.note,
          matchedEmployeeSeq: body.matchedEmployeeSeq !== undefined ? body.matchedEmployeeSeq : cur.matchedEmployeeSeq,
          categorySetBy: body.category ? "user" : cur.categorySetBy,
          updatedAt: new Date().toISOString(),
        };
        audit(db, body.actor, "banking.update", txnId, { category: db.banking[i].category });
        save(db);
        return send(res, 200, { transaction: db.banking[i] });
      }
      if (req.method === "DELETE") {
        const body = await readBody(req);
        db.banking.splice(i, 1);
        audit(db, body.actor, "banking.delete", txnId, {});
        save(db);
        return send(res, 200, { ok: true });
      }
    }

    // /hr/audit
    // ---- /hr/access (per-user permissions) — mirrors the Lambda ----
    // Admins are NOT stored here; admin identity comes from HR_ADMIN_EMAILS in
    // the app, so nothing written through this route can grant admin rights.
    if (parts[0] === "hr" && parts[1] === "access" && parts.length === 2) {
      if (req.method === "GET") return send(res, 200, { grants: db.grants ?? {} });
      if (req.method === "PUT") {
        const body = await readBody(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!email) return send(res, 400, { error: "EMAIL_REQUIRED" });
        db.grants = { ...(db.grants ?? {}) };
        if (body.access === null) delete db.grants[email];
        else db.grants[email] = body.access;
        audit(db, body.actor, "access.update", email, { access: body.access ?? null });
        save(db);
        return send(res, 200, { grants: db.grants });
      }
    }

    if (parts[0] === "hr" && parts[1] === "audit" && parts.length === 2) {
      if (req.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500); // parity with the Lambda
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

// A taken port used to be SILENT: node emitted an unhandled 'error', this process
// died, and anything polling /hr/health got an answer from the STALE server still
// holding the port — so the E2E suite ran against another run's leftover data and
// failed a different assertion each time. Fail loudly instead.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[hr-dev-engine] FATAL: port ${PORT} is already in use — refusing to start (another dev engine is running).`);
  } else {
    console.error(`[hr-dev-engine] FATAL:`, err);
  }
  process.exit(1);
});

// Pass HR_ENGINE_PORT=0 to get an OS-assigned free port; the line below reports the
// REAL port, which is how the test harness learns where to connect (collision-proof).
server.listen(PORT, () => {
  console.log(`[hr-dev-engine] listening on http://localhost:${server.address().port}  (store: ${DB})`);
});
