// One-shot: create the ShieldSyncLabUsers table in the platform account.
// pk = userId (Cognito sub). PAY_PER_REQUEST. Idempotent (skips if it exists).
//
// Run once:  node create-users-table.mjs

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";
const TABLE = "ShieldSyncLabUsers";

async function platformCreds() {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-users-table",
    })
  );
  const c = r.Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

const db = new DynamoDBClient({ region: REGION, credentials: await platformCreds() });

try {
  await db.send(new DescribeTableCommand({ TableName: TABLE }));
  console.log(`${TABLE} already exists — nothing to do.`);
} catch (e) {
  if (e.name !== "ResourceNotFoundException") throw e;
  await db.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    })
  );
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=userId) in ${PLATFORM_ACCOUNT}.`);
}
