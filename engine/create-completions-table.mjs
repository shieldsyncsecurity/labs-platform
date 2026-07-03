// One-shot: create the ShieldSyncLabCompletions table in the platform account.
// pk = userId, sk = labSlug. PAY_PER_REQUEST. NO TTL — completions are permanent
// (unlike orders, which age out). Backs F2 server-side lab completion tracking:
// the /grade handler upserts a row here on every passing run so the dashboard
// can show a real "X of Y complete" and a per-card badge, and a later
// certificate feature (credentialId/HMAC) can layer on without a migration.
// Idempotent (skips if it exists). Run once:  node create-completions-table.mjs

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncLabCompletions";

const sts = new STSClient({ region: REGION });
const c = (await sts.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`, RoleSessionName: "create-completions-table" }))).Credentials;
const db = new DynamoDBClient({ region: REGION, credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken } });

try {
  await db.send(new DescribeTableCommand({ TableName: TABLE }));
  console.log(`${TABLE} already exists.`);
} catch (e) {
  if (e.name !== "ResourceNotFoundException") throw e;
  await db.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "labSlug", AttributeType: "S" },
    ],
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "labSlug", KeyType: "RANGE" },
    ],
  }));
  await waitUntilTableExists({ client: db, maxWaitTime: 60 }, { TableName: TABLE });
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=userId, sk=labSlug) in ${PLATFORM}.`);
}
