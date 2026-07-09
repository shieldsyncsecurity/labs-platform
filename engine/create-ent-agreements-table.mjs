// One-shot (OPERATOR-RUN): create the ShieldSyncEntAgreements DynamoDB table in
// the platform account (750294427884). W3-1 of the 2026-07-09 enterprise sprint:
// one row per legal document (Enterprise Agreement "msa" or DPA "dpa") an org is
// issued -- bodyText is the FULL rendered snapshot including negotiated edits,
// sha256 its integrity hash, status the draft/issued/accepted/superseded/void
// lifecycle (transitions CAS-guarded in entinfra.mjs).
//
// Same pattern as create-ent-tables.mjs (idempotent describe-then-create, inline
// GSI, PAY_PER_REQUEST, waits for ACTIVE) PLUS Point-in-Time Recovery: agreements
// are permanent legal records (NO TTL, like Orders), so PITR guards against an
// accidental delete/overwrite. PITR is (re)asserted even when the table already
// exists, with a short retry because DynamoDB can briefly report continuous
// backups as unavailable right after table creation.
//
//   node create-ent-agreements-table.mjs
//
// AFTER the table is ACTIVE, the ENTERPRISE Lambda's IAM policy needs (already
// added to deploy/policy-ent.json in this change):
//   arn:aws:dynamodb:us-east-1:750294427884:table/ShieldSyncEntAgreements
//   arn:aws:dynamodb:us-east-1:750294427884:table/ShieldSyncEntAgreements/index/*

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
  UpdateContinuousBackupsCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncEntAgreements";

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-ent-agreements-table",
    })
  )
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: { accessKeyId: cred.AccessKeyId, secretAccessKey: cred.SecretAccessKey, sessionToken: cred.SessionToken },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -- table (idempotent) --------------------------------------------------------
try {
  await db.send(new DescribeTableCommand({ TableName: TABLE }));
  console.log(`${TABLE} already exists.`);
} catch (e) {
  if (e.name !== "ResourceNotFoundException") throw e;
  await db.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "agreementId", AttributeType: "S" },
        { AttributeName: "orgId", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "agreementId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          // orgId-index: list an org's agreements in the portal/admin without a
          // Scan. PROJECTION=ALL to match the other Ent tables' GSIs; the LIST
          // endpoint still strips bodyText app-side (entinfra.listAgreements).
          IndexName: "orgId-index",
          KeySchema: [{ AttributeName: "orgId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    })
  );
  await waitUntilTableExists({ client: db, maxWaitTime: 300 }, { TableName: TABLE });
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=agreementId) + GSI [orgId-index] in ${PLATFORM}.`);
}

// NO TTL on this table -- agreements are permanent legal records (W3-1).

// -- PITR (idempotent, re-asserted every run) -----------------------------------
// DescribeContinuousBackups can report the feature as still initializing for a
// short window after table creation; retry a few times before giving up loudly.
let pitrDone = false;
for (let attempt = 1; attempt <= 5 && !pitrDone; attempt++) {
  try {
    const cb = await db.send(new DescribeContinuousBackupsCommand({ TableName: TABLE }));
    const status =
      cb.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
    if (status === "ENABLED") {
      console.log(`  PITR already ENABLED on ${TABLE}.`);
      pitrDone = true;
      break;
    }
    await db.send(
      new UpdateContinuousBackupsCommand({
        TableName: TABLE,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      })
    );
    console.log(`  Enabled PITR on ${TABLE}.`);
    pitrDone = true;
  } catch (e) {
    if (attempt === 5) throw e;
    console.log(`  PITR not ready yet (${e.name}); retrying in 10s (attempt ${attempt}/5)...`);
    await sleep(10000);
  }
}

console.log(
  `\n${TABLE} ensured with PITR. IAM: table + /index/* ARNs are in deploy/policy-ent.json -- re-apply the policy to the ShieldSyncEnterpriseEngine role if not yet done.`
);
