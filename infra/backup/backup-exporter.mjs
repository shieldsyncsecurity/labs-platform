// ShieldSync — scheduled DynamoDB backup exporter (Lambda).
//
// Runs daily (EventBridge). For every ShieldSync* DynamoDB table it starts a
// point-in-time Export-to-S3 into the cross-region backup bucket. The export
// uses the table's continuous backup (PITR) so it costs NO read capacity and
// never touches the live table. Each run lands under exports/<YYYY-MM-DD>/<table>/.
//
// Why native export (not AWS Backup): the artifacts are plain DYNAMODB_JSON
// files in S3 you can download, grep, or re-import into a fresh table / account
// / region with `aws dynamodb import-table` — the most portable, no-lock-in
// backup format. See DR-RUNBOOK.md for restore steps.
//
// Env: BACKUP_BUCKET (S3 bucket name), BACKUP_BUCKET_OWNER (account id that owns
// the bucket), TABLE_PREFIX (default "ShieldSync"), SOURCE_REGION (tables' region).

import {
  DynamoDBClient,
  ListTablesCommand,
  ExportTableToPointInTimeCommand,
} from "@aws-sdk/client-dynamodb";

const SOURCE_REGION = process.env.SOURCE_REGION || "us-east-1";
const ACCOUNT_ID = process.env.BACKUP_BUCKET_OWNER || process.env.ACCOUNT_ID;
const BUCKET = process.env.BACKUP_BUCKET;
const PREFIX = process.env.TABLE_PREFIX || "ShieldSync";

const ddb = new DynamoDBClient({ region: SOURCE_REGION });

// YYYY-MM-DD in UTC — Date is allowed in Lambda (this is not a workflow script).
function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function listShieldSyncTables() {
  const names = [];
  let ExclusiveStartTableName;
  do {
    const r = await ddb.send(new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }));
    for (const n of r.TableNames ?? []) if (n.startsWith(PREFIX)) names.push(n);
    ExclusiveStartTableName = r.LastEvaluatedTableName;
  } while (ExclusiveStartTableName);
  return names;
}

export async function handler() {
  if (!BUCKET) throw new Error("BACKUP_BUCKET env is required");
  const stamp = dateStamp();
  const tables = await listShieldSyncTables();
  console.log(`[backup] ${stamp}: exporting ${tables.length} tables -> s3://${BUCKET}/exports/${stamp}/`);

  const ok = [];
  const failed = [];
  for (const name of tables) {
    const tableArn = `arn:aws:dynamodb:${SOURCE_REGION}:${ACCOUNT_ID}:table/${name}`;
    try {
      const r = await ddb.send(
        new ExportTableToPointInTimeCommand({
          TableArn: tableArn,
          S3Bucket: BUCKET,
          S3BucketOwner: ACCOUNT_ID,
          S3Prefix: `exports/${stamp}/${name}`,
          ExportFormat: "DYNAMODB_JSON",
          // ExportTime defaults to "now"; a point-in-time consistent snapshot.
        })
      );
      ok.push(name);
      console.log(`[backup]   started ${name}: ${r.ExportDescription?.ExportArn}`);
    } catch (e) {
      failed.push({ name, error: `${e.name}: ${e.message}` });
      console.error(`[backup]   FAILED ${name}: ${e.name}: ${e.message}`);
    }
  }

  const summary = { stamp, total: tables.length, started: ok.length, failed: failed.length, failures: failed };
  console.log("[backup] summary:", JSON.stringify(summary));
  // Only hard-fail if EVERY table failed (a systemic problem worth an alarm);
  // partial failures are logged + surfaced in the summary but don't mask the
  // exports that did start.
  if (tables.length > 0 && ok.length === 0) {
    throw new Error(`[backup] all ${tables.length} exports failed`);
  }
  return summary;
}
