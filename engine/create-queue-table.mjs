// One-shot: create the ShieldSyncLabQueue table in the platform account.
// pk = userId. PAY_PER_REQUEST. TTL on `ttl` (epoch seconds) so abandoned
// waiters age out automatically. Idempotent (skips if it exists; enables TTL
// if the table is there but TTL isn't on yet).
//
// Run once:  node create-queue-table.mjs

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
const PLATFORM_ACCOUNT = "750294427884";
const TABLE = "ShieldSyncLabQueue";

async function platformCreds() {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-queue-table",
    })
  );
  const c = r.Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

const db = new DynamoDBClient({ region: REGION, credentials: await platformCreds() });

try {
  await db.send(new DescribeTableCommand({ TableName: TABLE }));
  console.log(`${TABLE} already exists.`);
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
  await waitUntilTableExists({ client: db, maxWaitTime: 60 }, { TableName: TABLE });
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=userId) in ${PLATFORM_ACCOUNT}.`);
}

// Ensure TTL is enabled on `ttl`.
const ttlState = await db.send(new DescribeTimeToLiveCommand({ TableName: TABLE }));
const status = ttlState.TimeToLiveDescription?.TimeToLiveStatus;
if (status === "ENABLED" || status === "ENABLING") {
  console.log(`TTL already ${status} on ${TABLE}.`);
} else {
  await db.send(
    new UpdateTimeToLiveCommand({
      TableName: TABLE,
      TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
    })
  );
  console.log(`Enabled TTL on ${TABLE}.ttl.`);
}
