// Doc-signing portal test harness -- runs the ENT HANDLER IN-PROCESS in local
// mode (no Lambda, no SES sends because ENT_OTP_FROM stays unset, devCode
// returned) against the REAL ShieldSyncEntDocs table + docs bucket in the
// platform account. Burns nothing (pure DynamoDB + S3; no account leases).
//
// Prereqs:  node create-ent-docs-infra.mjs   (table + bucket must exist)
// Run:      node ent-docs-test.mjs           (default AWS profile that can
//           assume OrganizationAccountAccessRole into 750, e.g. apiuserforclaude)
//
// Cleans up after itself: test rows are DeleteItem'd directly and the S3
// objects removed, so no fake "documents" linger in the admin list.

import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Local mode: no engine secret (guard disabled outside Lambda), no OTP sender.
delete process.env.ENT_ENGINE_SECRET;
delete process.env.ENT_OTP_FROM;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const { handler } = await import("./ent-handler.mjs");

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncEntDocs";
const BUCKET = `shieldsync-ent-docs-${PLATFORM}`;

// -- direct-access clients for forced-state + cleanup (NOT via the handler) ----
const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "ent-docs-test",
    })
  )
).Credentials;
const credentials = {
  accessKeyId: cred.AccessKeyId,
  secretAccessKey: cred.SecretAccessKey,
  sessionToken: cred.SessionToken,
};
const ddb = new DynamoDBClient({ region: REGION, credentials });
const s3 = new S3Client({ region: REGION, credentials });

// -- tiny API-GW-v2-shaped invoker ---------------------------------------------
async function call(method, path, { body, query } = {}) {
  const event = {
    requestContext: { http: { method } },
    rawPath: path,
    headers: {},
    queryStringParameters: query,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const r = await handler(event);
  return { status: r.statusCode, body: JSON.parse(r.body) };
}

const newHex = (bytes = 16) => randomBytes(bytes).toString("hex");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// A minimal but real one-page PDF so viewers can open what we store.
const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 72 720 Td (ShieldSync test) Tj ET
endstream
endobj
trailer<</Root 1 0 R>>
%%EOF`,
  "latin1"
);

let pass = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ok ${pass}: ${name}`);
  } else {
    console.error(`  FAIL: ${name}`, extra ?? "");
    process.exitCode = 1;
    throw new Error(`assertion failed: ${name}`);
  }
}

const cleanup = { tokens: [] };

try {
  // ── 1. register ────────────────────────────────────────────────────────────
  const t1 = newHex();
  cleanup.tokens.push(t1);
  let r = await call("POST", "/ent/docs", {
    body: {
      docToken: t1,
      title: "Test proposal (harness)",
      fileName: "../evil path/Test Proposal.PDF",
      signerName: "Test Signer",
      signerEmail: "signer@example.com",
      note: "harness row",
      expiresDays: 7,
      pdfBase64: PDF.toString("base64"),
      actor: "harness",
    },
  });
  ok("register 200", r.status === 200, r);
  ok("register sha256 matches", r.body.sha256 === sha256(PDF));
  ok("register status pending", r.body.status === "pending");
  ok("fileName sanitized (no path, .pdf kept)", r.body.fileName === "Test Proposal.PDF", r.body.fileName);

  // idempotent retry (same token + same bytes)
  r = await call("POST", "/ent/docs", {
    body: { docToken: t1, title: "x", fileName: "y.pdf", signerEmail: "signer@example.com", pdfBase64: PDF.toString("base64"), actor: "harness" },
  });
  ok("idempotent re-register -> already", r.status === 200 && r.body.already === true, r);

  // token reuse with DIFFERENT content -> refused
  const otherPdf = Buffer.concat([PDF, Buffer.from(" ")]);
  r = await call("POST", "/ent/docs", {
    body: { docToken: t1, title: "x", fileName: "y.pdf", signerEmail: "signer@example.com", pdfBase64: otherPdf.toString("base64"), actor: "harness" },
  });
  ok("token reuse w/ new content -> 409 DOC_TOKEN_REUSED", r.status === 409 && r.body.error === "DOC_TOKEN_REUSED", r);

  // invalid payloads
  r = await call("POST", "/ent/docs", {
    body: { docToken: newHex(), title: "x", fileName: "y.pdf", signerEmail: "signer@example.com", pdfBase64: Buffer.from("not a pdf").toString("base64"), actor: "harness" },
  });
  ok("non-PDF bytes -> 400 PDF_INVALID", r.status === 400 && r.body.error === "PDF_INVALID", r);
  const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4 * 1024 * 1024)]);
  r = await call("POST", "/ent/docs", {
    body: { docToken: newHex(), title: "x", fileName: "y.pdf", signerEmail: "signer@example.com", pdfBase64: big.toString("base64"), actor: "harness" },
  });
  ok("oversize -> 400 PDF_TOO_LARGE", r.status === 400 && r.body.error === "PDF_TOO_LARGE", r);
  r = await call("POST", "/ent/docs", {
    body: { docToken: newHex(), title: "x", fileName: "y.pdf", signerEmail: "not-an-email", pdfBase64: PDF.toString("base64"), actor: "harness" },
  });
  ok("bad signer email -> 400", r.status === 400 && r.body.error === "SIGNER_EMAIL_INVALID", r);

  // ── 2. public fetches ───────────────────────────────────────────────────────
  r = await call("GET", "/ent/doc", { query: { docToken: t1 } });
  ok("public get 200 + sanitized", r.status === 200 && r.body.signerEmailMasked === "s***@example.com" && r.body.signerEmail === undefined && r.body.otpHash === undefined && r.body.s3Key === undefined, r.body);

  r = await call("GET", "/ent/doc/pdf", { query: { docToken: t1 } });
  ok("pdf roundtrip bytes identical", r.status === 200 && Buffer.from(r.body.pdfBase64, "base64").equals(PDF));

  r = await call("GET", "/ent/doc", { query: { docToken: newHex() } });
  ok("unknown token -> 404", r.status === 404);

  // ── 3. OTP + accept ─────────────────────────────────────────────────────────
  // accept before any OTP was issued -> expired-code flag
  r = await call("POST", "/ent/docs/accept", { body: { docToken: t1, code: "000000", typedName: "Test Signer" } });
  ok("accept before otp -> expired flag", r.status === 200 && r.body.ok === false && r.body.expired === true, r);

  r = await call("POST", "/ent/docs/otp/send", { body: { docToken: t1 } });
  ok("otp send 200 + devCode locally", r.status === 200 && /^\d{6}$/.test(r.body.devCode ?? ""), r);
  const code = r.body.devCode;

  r = await call("POST", "/ent/docs/otp/send", { body: { docToken: t1 } });
  ok("otp resend inside cooldown -> 429", r.status === 429 && r.body.error === "OTP_COOLDOWN", r);

  const wrong = code === "999999" ? "111111" : "999999";
  r = await call("POST", "/ent/docs/accept", { body: { docToken: t1, code: wrong, typedName: "Test Signer" } });
  ok("wrong code burns an attempt", r.status === 200 && r.body.ok === false && r.body.attemptsLeft === 4, r);

  r = await call("POST", "/ent/docs/accept", {
    body: { docToken: t1, code, typedName: "  Test Signer  ", ip: "203.0.113.7", userAgent: "harness-UA/1.0" },
  });
  ok("accept 200 ok", r.status === 200 && r.body.ok === true, r);
  const acc = r.body.doc;
  ok("acceptance record complete", acc.status === "signed" && acc.acceptedName === "Test Signer" && acc.acceptedEmail === "signer@example.com" && acc.docHash === sha256(PDF) && acc.acceptIp === "203.0.113.7" && acc.acceptUa === "harness-UA/1.0" && !!acc.acceptedAt, acc);

  r = await call("POST", "/ent/docs/accept", { body: { docToken: t1, code, typedName: "Test Signer" } });
  ok("double-accept idempotent -> already", r.status === 200 && r.body.already === true, r);

  r = await call("POST", "/ent/docs/otp/send", { body: { docToken: t1 } });
  ok("otp send on signed -> 409 ALREADY_SIGNED", r.status === 409 && r.body.error === "ALREADY_SIGNED", r);

  r = await call("POST", "/ent/docs/revoke", { body: { docToken: t1, actor: "harness" } });
  ok("revoke signed -> 409 NOT_REVOCABLE", r.status === 409 && r.body.error === "NOT_REVOCABLE", r);

  r = await call("GET", "/ent/doc", { query: { docToken: t1 } });
  ok("signed doc still viewable", r.status === 200 && r.body.status === "signed");

  // ── 4. revoke + expiry lifecycles on a second doc ───────────────────────────
  const t2 = newHex();
  cleanup.tokens.push(t2);
  r = await call("POST", "/ent/docs", {
    body: { docToken: t2, title: "Second (revoke target)", fileName: "b.pdf", signerEmail: "signer@example.com", pdfBase64: PDF.toString("base64"), actor: "harness" },
  });
  ok("second register 200", r.status === 200);

  r = await call("POST", "/ent/docs/resend", { body: { docToken: t2, actor: "harness" } });
  ok("resend pending 200 (emailed:false locally)", r.status === 200 && r.body.emailed === false, r);
  r = await call("POST", "/ent/docs/resend", { body: { docToken: t2, actor: "harness" } });
  ok("resend inside cooldown -> 429", r.status === 429 && r.body.error === "RESEND_COOLDOWN", r);

  r = await call("POST", "/ent/docs/revoke", { body: { docToken: t2, actor: "harness" } });
  ok("revoke pending 200", r.status === 200 && r.body.ok === true, r);
  r = await call("GET", "/ent/doc", { query: { docToken: t2 } });
  ok("revoked -> 404 (oracle-free)", r.status === 404);
  r = await call("GET", "/ent/doc/pdf", { query: { docToken: t2 } });
  ok("revoked pdf -> 404", r.status === 404);
  r = await call("POST", "/ent/docs/otp/send", { body: { docToken: t2 } });
  ok("revoked otp send -> 404", r.status === 404);

  // expiry: force the third doc's expiresAt into the past directly in DDB
  const t3 = newHex();
  cleanup.tokens.push(t3);
  r = await call("POST", "/ent/docs", {
    body: { docToken: t3, title: "Third (expiry target)", fileName: "c.pdf", signerEmail: "signer@example.com", pdfBase64: PDF.toString("base64"), actor: "harness" },
  });
  ok("third register 200", r.status === 200);
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: { docToken: { S: t3 } },
      UpdateExpression: "SET expiresAt = :e",
      ExpressionAttributeValues: { ":e": { S: new Date(Date.now() - 60000).toISOString() } },
    })
  );
  r = await call("GET", "/ent/doc", { query: { docToken: t3 } });
  ok("expired pending -> 410", r.status === 410 && r.body.error === "LINK_EXPIRED", r);
  r = await call("POST", "/ent/docs/otp/send", { body: { docToken: t3 } });
  ok("expired otp send -> 410", r.status === 410);
  r = await call("POST", "/ent/docs/accept", { body: { docToken: t3, code: "000000", typedName: "Nobody" } });
  ok("expired accept -> 410", r.status === 410);

  // ── 5. admin list ────────────────────────────────────────────────────────────
  r = await call("GET", "/ent/docs");
  const rows = r.body.docs.filter((d) => cleanup.tokens.includes(d.docToken));
  ok("list contains all 3 harness rows", r.status === 200 && rows.length === 3, rows.length);
  ok("list rows carry no otpHash", rows.every((d) => d.otpHash === undefined));

  console.log(`\nALL ${pass} CHECKS PASSED`);
} finally {
  // -- cleanup: remove harness rows + objects so the admin list stays real ----
  for (const t of cleanup.tokens) {
    await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { docToken: { S: t } } })).catch(() => {});
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `docs/${t}.pdf` })).catch(() => {});
  }
  console.log(`cleanup: removed ${cleanup.tokens.length} harness docs (rows + objects).`);
}
