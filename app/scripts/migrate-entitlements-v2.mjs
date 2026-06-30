// ─────────────────────────────────────────────────────────────────────────────
// migrate-entitlements-v2.mjs
//
// One-shot, idempotent migration for the pay-per-lab v2 entitlement schema.
//
// What it does:
//   Scans the ShieldSyncLabEntitlements DynamoDB table (account 750294427884,
//   us-east-1) and, for every row that does NOT already have a `type` attribute,
//   stamps the LIFETIME grandfather shape:
//       type          = "LIFETIME"
//       launchCount   = 0
//       maxLaunches   = null
//       version       = 0
//       updatedAt     = <now ISO>
//
// Safety:
//   - The UpdateItem uses ConditionExpression `attribute_not_exists(#type)` so
//     re-running is a no-op for rows that already migrated. Counts are reported
//     so you can tell what happened.
//   - --dry-run scans + classifies but writes nothing.
//
// Why not run inside the engine handler:
//   This is a one-time backfill. Keeping it as a stand-alone CLI lets us run it
//   from a workstation with assumed-role creds, the same pattern as the
//   engine/create-*.mjs scripts.
//
// How to run:
//     # From: labs-platform/app/scripts
//     node migrate-entitlements-v2.mjs            # do the migration
//     node migrate-entitlements-v2.mjs --dry-run  # count only, no writes
//
// Requires: caller has STS:AssumeRole into
//   arn:aws:iam::750294427884:role/OrganizationAccountAccessRole
// (same as the engine bootstrap scripts).
// ─────────────────────────────────────────────────────────────────────────────

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM_ACCOUNT = "750294427884";
const TABLE = "ShieldSyncLabEntitlements";

const DRY_RUN = process.argv.includes("--dry-run");

async function platformCreds() {
  const sts = new STSClient({ region: REGION });
  const r = await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "migrate-entitlements-v2",
    })
  );
  const c = r.Credentials;
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
  };
}

const db = new DynamoDBClient({ region: REGION, credentials: await platformCreds() });

let examined = 0;
let migrated = 0;
let skipped = 0;
let lastKey;

do {
  const out = await db.send(
    new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
      // Pull only what we need to classify + key the update.
      ProjectionExpression: "userId, labSlug, #t",
      ExpressionAttributeNames: { "#t": "type" },
    })
  );
  for (const item of out.Items ?? []) {
    examined++;
    const alreadyMigrated = !!item.type;
    if (alreadyMigrated) {
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      migrated++; // would-be migrated
      continue;
    }
    try {
      const now = new Date().toISOString();
      await db.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { userId: item.userId, labSlug: item.labSlug },
          UpdateExpression:
            "SET #type = :lifetime, launchCount = :zero, maxLaunches = :null, version = :zero, updatedAt = :now",
          ConditionExpression: "attribute_not_exists(#type)",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: {
            ":lifetime": { S: "LIFETIME" },
            ":zero": { N: "0" },
            ":null": { NULL: true },
            ":now": { S: now },
          },
        })
      );
      migrated++;
    } catch (e) {
      if (e.name === "ConditionalCheckFailedException") {
        // Raced with another writer — already migrated, treat as skipped.
        skipped++;
      } else {
        console.error(
          `failed to migrate userId=${item.userId?.S} labSlug=${item.labSlug?.S}:`,
          e.message
        );
      }
    }
  }
  lastKey = out.LastEvaluatedKey;
} while (lastKey);

console.log(
  `${DRY_RUN ? "[dry-run] " : ""}examined=${examined} migrated=${migrated} skipped=${skipped}`
);
