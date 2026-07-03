// One-shot (OPERATOR-RUN): add a `credentialId-index` GSI to the existing
// ShieldSyncLabCompletions table. HASH=credentialId, PROJECTION=ALL,
// PAY_PER_REQUEST (matches the base table's billing mode). Backs F3's public
// /verify/<credentialId> lookup (getCompletionByCredential in labinfra.mjs) —
// without this GSI, GET /completions/by-credential 500s (or the engine
// catches it and returns "not found", per getCompletionByCredential's
// try/catch — check CloudWatch if verify pages keep 404ing).
//
// Mirrors create-completions-table.mjs's auth/connection pattern. Idempotent:
// skips if the index already exists or is still being created/deleted.
//
// NOT run automatically by this change — the human operator runs it once:
//   node create-completions-gsi.mjs
//
// After it's ACTIVE, also add the table's /index/* ARN to
// engine/deploy/policy.json's DynamoDB Resource list (dynamodb:Query on a GSI
// requires the index ARN, not just the table ARN) and redeploy the Lambda's
// IAM policy — see policy.json's "DynamoDB" statement, which already lists
// the ShieldSyncLabCompletions table ARN.

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  UpdateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const TABLE = "ShieldSyncLabCompletions";
const INDEX_NAME = "credentialId-index";

const sts = new STSClient({ region: REGION });
const c = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-completions-gsi",
    })
  )
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
});

const desc = await db.send(new DescribeTableCommand({ TableName: TABLE }));
const existing = (desc.Table?.GlobalSecondaryIndexes ?? []).find((i) => i.IndexName === INDEX_NAME);

if (existing) {
  console.log(`${INDEX_NAME} already exists on ${TABLE} (status: ${existing.IndexStatus}).`);
} else {
  await db.send(
    new UpdateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [
        // Existing key attrs (userId, labSlug) don't need to be repeated here —
        // only NEW attributes used by the new index must be declared.
        { AttributeName: "credentialId", AttributeType: "S" },
      ],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: INDEX_NAME,
            KeySchema: [{ AttributeName: "credentialId", KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
    })
  );
  console.log(`Creating ${INDEX_NAME} on ${TABLE} — waiting for it to become active (this can take a few minutes)...`);
  await waitUntilTableExists({ client: db, maxWaitTime: 300 }, { TableName: TABLE });
  console.log(`${INDEX_NAME} created on ${TABLE} (PAY_PER_REQUEST, HASH=credentialId, PROJECTION=ALL) in ${PLATFORM}.`);
  console.log(`Next: add "arn:aws:dynamodb:${REGION}:${PLATFORM}:table/${TABLE}/index/*" to engine/deploy/policy.json and redeploy the Lambda's IAM policy.`);
}
