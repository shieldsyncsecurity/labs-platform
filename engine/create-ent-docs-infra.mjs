// One-shot (OPERATOR-RUN): create the doc-signing portal's storage in the
// platform account (750294427884):
//   1. DynamoDB table ShieldSyncEntDocs -- one row per registered document +
//      its acceptance record. pk = docToken (the /sign/<token> bearer). NO GSI
//      (list = Scan, human-scale like Leads), NO TTL (documents + acceptance
//      records are permanent business/legal records, like Agreements/Orders),
//      PITR ON (re-asserted every run, same as create-ent-agreements-table.mjs).
//   2. S3 bucket shieldsync-ent-docs-750294427884 -- the PDF bytes. PRIVATE
//      (BlockPublicAccess all-on), versioning ENABLED (accidental-overwrite
//      guard for legal records; registration also refuses token reuse), SSE-S3
//      default encryption. Objects are keyed docs/<docToken>.pdf.
//
//   node create-ent-docs-infra.mjs
//
// AFTER this is ACTIVE, the ENTERPRISE Lambda's IAM policy needs (already added
// to deploy/policy-ent.json in this change; re-apply via deploy-ent.ps1 step 2):
//   dynamodb table arn .../table/ShieldSyncEntDocs
//   s3:PutObject + s3:GetObject on arn:aws:s3:::shieldsync-ent-docs-750294427884/*

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
  UpdateContinuousBackupsCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketVersioningCommand,
} from "@aws-sdk/client-s3";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncEntDocs";
const BUCKET = `shieldsync-ent-docs-${PLATFORM}`;

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-ent-docs-infra",
    })
  )
).Credentials;
const credentials = {
  accessKeyId: cred.AccessKeyId,
  secretAccessKey: cred.SecretAccessKey,
  sessionToken: cred.SessionToken,
};
const db = new DynamoDBClient({ region: REGION, credentials });
const s3 = new S3Client({ region: REGION, credentials });

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
      AttributeDefinitions: [{ AttributeName: "docToken", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "docToken", KeyType: "HASH" }],
    })
  );
  await waitUntilTableExists({ client: db, maxWaitTime: 300 }, { TableName: TABLE });
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=docToken, no GSI) in ${PLATFORM}.`);
}

// NO TTL on this table -- documents + acceptance records are permanent.

// -- PITR (idempotent, re-asserted every run) -----------------------------------
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

// -- S3 bucket (idempotent) ------------------------------------------------------
let bucketExists = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  bucketExists = true;
  console.log(`${BUCKET} already exists.`);
} catch (e) {
  if (e.name !== "NotFound" && e.$metadata?.httpStatusCode !== 404 && e.$metadata?.httpStatusCode !== 403) throw e;
}
if (!bucketExists) {
  // us-east-1: CreateBucket takes NO LocationConstraint.
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  console.log(`Created s3://${BUCKET}.`);
}

// Both settings re-asserted every run (idempotent), like PITR above.
await s3.send(
  new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  })
);
console.log(`  Block-public-access: all ON.`);
await s3.send(
  new PutBucketVersioningCommand({
    Bucket: BUCKET,
    VersioningConfiguration: { Status: "Enabled" },
  })
);
console.log(`  Versioning: ENABLED.`);

console.log(
  `\n${TABLE} + s3://${BUCKET} ensured. IAM: table ARN + bucket object ARN are in deploy/policy-ent.json -- re-apply the policy to the ShieldSyncEnterpriseEngine role (deploy-ent.ps1 does this) if not yet done.`
);
