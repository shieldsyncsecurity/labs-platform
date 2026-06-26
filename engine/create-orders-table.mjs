// One-shot: create the ShieldSyncLabOrders table in the platform account.
// pk = orderId. PAY_PER_REQUEST. TTL on `ttl` (epoch seconds) so old orders age
// out (~90 days). Backs the payment trust path (runbook §6d): the webhook validates
// a provider payment against the persisted order (amount/currency) and grants only
// on an idempotent created->paid transition. Idempotent (skips if it exists; enables
// TTL if missing). Run once:  node create-orders-table.mjs

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
const TABLE = "ShieldSyncLabOrders";

const sts = new STSClient({ region: REGION });
const c = (await sts.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`, RoleSessionName: "create-orders-table" }))).Credentials;
const db = new DynamoDBClient({ region: REGION, credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken } });

try {
  await db.send(new DescribeTableCommand({ TableName: TABLE }));
  console.log(`${TABLE} already exists.`);
} catch (e) {
  if (e.name !== "ResourceNotFoundException") throw e;
  await db.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [{ AttributeName: "orderId", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "orderId", KeyType: "HASH" }],
  }));
  await waitUntilTableExists({ client: db, maxWaitTime: 60 }, { TableName: TABLE });
  console.log(`Created ${TABLE} (PAY_PER_REQUEST, pk=orderId) in ${PLATFORM}.`);
}

const ttl = await db.send(new DescribeTimeToLiveCommand({ TableName: TABLE }));
const status = ttl.TimeToLiveDescription?.TimeToLiveStatus;
if (status === "ENABLED" || status === "ENABLING") {
  console.log(`TTL already ${status} on ${TABLE}.`);
} else {
  await db.send(new UpdateTimeToLiveCommand({ TableName: TABLE, TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" } }));
  console.log(`Enabled TTL on ${TABLE}.ttl.`);
}
