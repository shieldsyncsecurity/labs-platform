// One-shot (OPERATOR-RUN): create the HR portal's DynamoDB tables in the
// platform account (750294427884), ISOLATED from every enterprise/labs table.
//
//   ShieldSyncHrEmployees   pk=seq (N)                     employee master; item seq=0 is the id counter
//   ShieldSyncHrDocuments   pk=employeeSeq (N), sk=docId   KYC/document metadata (bytes in S3)
//   ShieldSyncHrAudit       pk=auditId (S)                 durable action log
//
// All PAY_PER_REQUEST, PITR ON (re-asserted every run), no TTL (HR records are
// permanent employment records). The employee counter is seeded to 7 so the
// first employee is SSS/EMP/0008 (Diya's 0007 already exists on paper).
//
//   node create-hr-tables.mjs
//
// AFTER this + create-hr-kyc-infra.mjs, deploy the Lambda: .\deploy\deploy-hr.ps1

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
  UpdateContinuousBackupsCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-hr-tables",
    }),
  )
).Credentials;
const credentials = {
  accessKeyId: cred.AccessKeyId,
  secretAccessKey: cred.SecretAccessKey,
  sessionToken: cred.SessionToken,
};
const db = new DynamoDBClient({ region: REGION, credentials });
const doc = DynamoDBDocumentClient.from(db);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPECS = [
  {
    TableName: "ShieldSyncHrEmployees",
    AttributeDefinitions: [{ AttributeName: "seq", AttributeType: "N" }],
    KeySchema: [{ AttributeName: "seq", KeyType: "HASH" }],
  },
  {
    TableName: "ShieldSyncHrDocuments",
    AttributeDefinitions: [
      { AttributeName: "employeeSeq", AttributeType: "N" },
      { AttributeName: "docId", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "employeeSeq", KeyType: "HASH" },
      { AttributeName: "docId", KeyType: "RANGE" },
    ],
  },
  {
    TableName: "ShieldSyncHrAudit",
    AttributeDefinitions: [{ AttributeName: "auditId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "auditId", KeyType: "HASH" }],
  },
];

for (const spec of SPECS) {
  try {
    await db.send(new DescribeTableCommand({ TableName: spec.TableName }));
    console.log(`${spec.TableName} already exists.`);
  } catch (e) {
    if (e.name !== "ResourceNotFoundException") throw e;
    await db.send(new CreateTableCommand({ ...spec, BillingMode: "PAY_PER_REQUEST" }));
    await waitUntilTableExists({ client: db, maxWaitTime: 300 }, { TableName: spec.TableName });
    console.log(`Created ${spec.TableName} (PAY_PER_REQUEST).`);
  }

  // PITR (idempotent, re-asserted every run).
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const cb = await db.send(new DescribeContinuousBackupsCommand({ TableName: spec.TableName }));
      const status = cb.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
      if (status === "ENABLED") {
        console.log(`  PITR already ENABLED on ${spec.TableName}.`);
        break;
      }
      await db.send(
        new UpdateContinuousBackupsCommand({
          TableName: spec.TableName,
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      );
      console.log(`  Enabled PITR on ${spec.TableName}.`);
      break;
    } catch (e) {
      if (attempt === 5) throw e;
      console.log(`  PITR not ready (${e.name}); retry in 10s (${attempt}/5)...`);
      await sleep(10000);
    }
  }
}

// Seed the employee id counter (idempotent): first new employee -> SSS/EMP/0008.
const existing = await doc.send(new GetCommand({ TableName: "ShieldSyncHrEmployees", Key: { seq: 0 } }));
if (!existing.Item) {
  await doc.send(new PutCommand({ TableName: "ShieldSyncHrEmployees", Item: { seq: 0, counter: 7 } }));
  console.log("Seeded id counter at 7 (first employee = SSS/EMP/0008).");
} else {
  console.log(`Id counter already present (counter=${existing.Item.counter}).`);
}

// Seed the unified letter-reference counter for the SSS/HR/2026 series at 14 —
// the manually issued series is at SSS/HR/2026/014, so the portal continues at
// 015. (Counter items live at negative seq keys: -(year*10) for HR,
// -(year*10+1) for the SSS/INT internship series; unseeded years start at 001.)
const refKey = -(2026 * 10);
const refItem = await doc.send(new GetCommand({ TableName: "ShieldSyncHrEmployees", Key: { seq: refKey } }));
if (!refItem.Item) {
  await doc.send(new PutCommand({ TableName: "ShieldSyncHrEmployees", Item: { seq: refKey, counter: 14 } }));
  console.log("Seeded SSS/HR/2026 letter-ref counter at 14 (next issue = 015).");
} else {
  console.log(`SSS/HR/2026 ref counter already present (counter=${refItem.Item.counter}).`);
}

console.log("\nHR tables ready. Next: node create-hr-kyc-infra.mjs, then .\\deploy\\deploy-hr.ps1");
