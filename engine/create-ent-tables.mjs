// One-shot (OPERATOR-RUN): create the 6 ShieldSync ENTERPRISE (B2B) DynamoDB tables
// in the platform account (750294427884). Backs enterprise.shieldsyncsecurity.com —
// the hiring-assessment product that reuses the labs engine but ships as its own
// Lambda (ShieldSyncEnterpriseEngine). Fully SEPARATE from the B2C labs tables; the
// enterprise data model never touches ShieldSyncLab* rows.
//
// All tables PAY_PER_REQUEST. GSIs are created INLINE at table-create time (unlike
// create-completions-gsi.mjs, which back-fills a GSI onto an existing table). TTL is
// enabled where rows should age out (24-month candidate-data retention; slot rows).
// Idempotent: skips any table that already exists; still (re)asserts TTL if missing.
//
//   node create-ent-tables.mjs
//
// AFTER all tables are ACTIVE, add these ARNs to the ENTERPRISE Lambda's IAM policy
// (a separate policy from engine/deploy/policy.json — the ent Lambda has its own role)
// so dynamodb:Query/Get/Put/Update/Delete + Query-on-GSI work:
//   arn:aws:dynamodb:us-east-1:750294427884:table/ShieldSyncEnt<Name>
//   arn:aws:dynamodb:us-east-1:750294427884:table/ShieldSyncEnt<Name>/index/*
// (the /index/* form is required for dynamodb:Query against a GSI, not just the base ARN).

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  DescribeTimeToLiveCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-ent-tables",
    })
  )
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: { accessKeyId: cred.AccessKeyId, secretAccessKey: cred.SecretAccessKey, sessionToken: cred.SessionToken },
});

// Each spec: { table, attrs, keys, gsis?, ttl? }
// - attrs: only attributes used in a KeySchema (base or GSI) must be declared.
// - gsis:  [{ name, hash }] — all HASH-only GSIs, PROJECTION=ALL (report/list lookups
//          need the full row), matching the base table's PAY_PER_REQUEST billing.
// - ttl:   attribute name holding an epoch-seconds expiry, or null for permanent rows.
const SPECS = [
  {
    // Organizations (buyers). pk=orgId. Holds credit ledger (creditsTotal/creditsUsed),
    // GSTIN + billing address, and the click-through agreement acceptance. Permanent.
    table: "ShieldSyncEntOrgs",
    attrs: [["orgId", "S"]],
    keys: [["orgId", "HASH"]],
    ttl: null,
  },
  {
    // Assessment templates. pk=assessmentId. One per "job" (which lab, name, hints on/off).
    // orgId-index: list an org's assessments in the portal. reportToken-index: resolve the
    // per-assessment secret report link (/r/<token>) without a Scan. Permanent (metadata).
    table: "ShieldSyncEntAssessments",
    attrs: [["assessmentId", "S"], ["orgId", "S"], ["reportToken", "S"]],
    keys: [["assessmentId", "HASH"]],
    gsis: [
      { name: "orgId-index", hash: "orgId" },
      { name: "reportToken-index", hash: "reportToken" },
    ],
    ttl: null,
  },
  {
    // Invites (one per candidate = one credit). pk=inviteToken (128-bit CSPRNG).
    // assessmentId-index: list candidates in an assessment. candidateReportToken-index:
    // resolve the per-candidate share link (/r/c/<token>). ttl=24-month retention on
    // candidate data (this row holds candidateName/Email + consent + OTP state).
    table: "ShieldSyncEntInvites",
    attrs: [["inviteToken", "S"], ["assessmentId", "S"], ["candidateReportToken", "S"]],
    keys: [["inviteToken", "HASH"]],
    gsis: [
      { name: "assessmentId-index", hash: "assessmentId" },
      { name: "candidateReportToken-index", hash: "candidateReportToken" },
    ],
    ttl: "ttl",
  },
  {
    // Slot booking counters (Calendly-style). pk=slotKey (e.g. "2026-07-10T15:00Z").
    // `booked` is an atomic counter guarded against real reserved-account capacity; a
    // conditional increment is how a candidate claims a slot. ttl ages out past slots.
    table: "ShieldSyncEntSlots",
    attrs: [["slotKey", "S"]],
    keys: [["slotKey", "HASH"]],
    ttl: "ttl",
  },
  {
    // Scored results. pk=assessmentId, sk=inviteToken — Query by assessmentId builds the
    // comparison table; Get by (assessmentId,inviteToken) builds one candidate's report.
    // Report data is PRE-COMPUTED into this row at submit (near-zero-CPU SSR). ttl=24-month
    // retention (holds score breakdown, CloudTrail timeline, reflection text).
    table: "ShieldSyncEntResults",
    attrs: [["assessmentId", "S"], ["inviteToken", "S"]],
    keys: [["assessmentId", "HASH"], ["inviteToken", "RANGE"]],
    ttl: "ttl",
  },
  {
    // Credit orders / GST invoices. pk=orderId. orgId-index: an org's billing history +
    // top-up flow. NO TTL — invoices are financial records, kept for GST/audit.
    table: "ShieldSyncEntOrders",
    attrs: [["orderId", "S"], ["orgId", "S"]],
    keys: [["orderId", "HASH"]],
    gsis: [{ name: "orgId-index", hash: "orgId" }],
    ttl: null,
  },
  {
    // Demo-request leads from the public landing (Book a walkthrough / pricing
    // form). pk=leadId. Lead rows are permanent sales-pipeline records (no ttl
    // attribute on them); `cooldown:<email-hash>` marker rows DO carry ttl so the
    // per-email flood gate self-cleans — hence TTL is enabled on the table.
    table: "ShieldSyncEntLeads",
    attrs: [["leadId", "S"]],
    keys: [["leadId", "HASH"]],
    ttl: "ttl",
  },
];

async function ensureTable(spec) {
  const { table, attrs, keys, gsis, ttl } = spec;
  try {
    await db.send(new DescribeTableCommand({ TableName: table }));
    console.log(`${table} already exists.`);
  } catch (e) {
    if (e.name !== "ResourceNotFoundException") throw e;
    await db.send(
      new CreateTableCommand({
        TableName: table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: attrs.map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType })),
        KeySchema: keys.map(([AttributeName, KeyType]) => ({ AttributeName, KeyType })),
        ...(gsis && {
          GlobalSecondaryIndexes: gsis.map((g) => ({
            IndexName: g.name,
            KeySchema: [{ AttributeName: g.hash, KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          })),
        }),
      })
    );
    // maxWaitTime allows for GSI backfill on create (a few minutes for large indexes; these start empty).
    await waitUntilTableExists({ client: db, maxWaitTime: 300 }, { TableName: table });
    const keyDesc = keys.map(([n, t]) => `${t === "HASH" ? "pk" : "sk"}=${n}`).join(", ");
    const gsiDesc = gsis ? ` + GSIs [${gsis.map((g) => g.name).join(", ")}]` : "";
    console.log(`Created ${table} (PAY_PER_REQUEST, ${keyDesc})${gsiDesc} in ${PLATFORM}.`);
  }

  if (!ttl) return;
  const desc = await db.send(new DescribeTimeToLiveCommand({ TableName: table }));
  const status = desc.TimeToLiveDescription?.TimeToLiveStatus;
  if (status === "ENABLED" || status === "ENABLING") {
    console.log(`  TTL already ${status} on ${table}.${ttl}.`);
  } else {
    await db.send(new UpdateTimeToLiveCommand({ TableName: table, TimeToLiveSpecification: { Enabled: true, AttributeName: ttl } }));
    console.log(`  Enabled TTL on ${table}.${ttl}.`);
  }
}

for (const spec of SPECS) {
  await ensureTable(spec);
}
console.log("\nAll enterprise tables ensured. Next: attach their table + /index/* ARNs to the ShieldSyncEnterpriseEngine Lambda role.");
