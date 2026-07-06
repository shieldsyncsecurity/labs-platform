// One-shot (OPERATOR-RUN): flag (or un-flag) a pool account as ENTERPRISE-RESERVED.
//
// A reserved account is drawn ONLY by the enterprise engine's leaseEnt() and is
// invisible to every B2C path (lease / ensureWarm / freeCapacity all filter out
// `entReserved:true`). This is the switch that actually carves enterprise capacity
// out of the shared pool. Until at least one account is flagged, entReservedCounts()
// returns { total: 0, ... } and enterprise /ent/start returns NO_CAPACITY — while
// B2C behaviour is completely unchanged.
//
// Usage:
//   node flag-ent-reserved.mjs <accountId>            # reserve it for enterprise
//   node flag-ent-reserved.mjs <accountId> --release  # return it to the B2C pool
//   node flag-ent-reserved.mjs --list                 # show current reservation state
//
// SCALING NOTE: with only 3 pool accounts today, reserving one leaves 2 for B2C.
// Grow the pool (AWS account-limit increase) before reserving more, so the B2C
// free-lab funnel isn't starved. Reserve an account only when it is `available`
// (not mid-lease) so you don't strand a live B2C session.

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const ACCOUNTS_TABLE = "ShieldSyncLabAccounts";

const args = process.argv.slice(2);
const list = args.includes("--list");
const release = args.includes("--release");
const accountId = args.find((a) => !a.startsWith("--"));

const sts = new STSClient({ region: REGION });
const c = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "flag-ent-reserved",
    })
  )
).Credentials;
const db = new DynamoDBClient({
  region: REGION,
  credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
});

if (list) {
  const r = await db.send(new ScanCommand({ TableName: ACCOUNTS_TABLE }));
  const rows = (r.Items ?? []).map((i) => ({
    accountId: i.accountId?.S,
    status: i.status?.S,
    entReserved: i.entReserved?.BOOL === true,
  }));
  const reserved = rows.filter((x) => x.entReserved);
  console.log(`Pool: ${rows.length} accounts — ${reserved.length} enterprise-reserved, ${rows.length - reserved.length} B2C.`);
  for (const x of rows) console.log(`  ${x.accountId}  status=${x.status}  ${x.entReserved ? "ENTERPRISE-RESERVED" : "b2c"}`);
  process.exit(0);
}

if (!accountId) {
  console.error("Usage: node flag-ent-reserved.mjs <accountId> [--release] | --list");
  process.exit(1);
}

// Confirm the account exists (and warn if it isn't currently available).
const existing = await db.send(new GetItemCommand({ TableName: ACCOUNTS_TABLE, Key: { accountId: { S: accountId } } }));
if (!existing.Item) {
  console.error(`Account ${accountId} not found in ${ACCOUNTS_TABLE}.`);
  process.exit(1);
}
const status = existing.Item.status?.S;
if (status !== "available") {
  console.warn(`⚠️  ${accountId} is currently "${status}" (not "available"). Reserving mid-lease can strand a live session — prefer flagging when available.`);
}

if (release) {
  await db.send(
    new UpdateItemCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { accountId: { S: accountId } },
      UpdateExpression: "REMOVE entReserved",
    })
  );
  console.log(`Released ${accountId} back to the B2C pool (entReserved removed).`);
} else {
  await db.send(
    new UpdateItemCommand({
      TableName: ACCOUNTS_TABLE,
      Key: { accountId: { S: accountId } },
      UpdateExpression: "SET entReserved = :t",
      ExpressionAttributeValues: { ":t": { BOOL: true } },
    })
  );
  console.log(`Reserved ${accountId} for enterprise (entReserved=true). It is now invisible to B2C lease/warm/capacity.`);
}
