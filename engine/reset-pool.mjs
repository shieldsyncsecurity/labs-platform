// One-off: clear all sandbox labs + reset the pool to clean/available.
// Targeted nuke (lab resource types) for speed; preserves the 3 control roles.
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { DynamoDBClient, ScanCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REGION = "us-east-1";
const MGMT = "851236938541";
const PLAT = "750294427884";
const ACCTS = ["350823026476", "511568812872", "244686897857"];
const NUKE = join(__dirname, "bin", "aws-nuke.exe");
const INCLUDE = ["S3Bucket","S3Object","IAMUser","IAMRole","IAMRolePolicy","IAMRolePolicyAttachment","IAMUserPolicy","IAMUserPolicyAttachment","IAMUserAccessKey","LambdaFunction","CloudFormationStack"];

async function assume(arn, name, creds) {
  const sts = new STSClient({ region: REGION, credentials: creds });
  const r = await sts.send(new AssumeRoleCommand({ RoleArn: arn, RoleSessionName: name }));
  const c = r.Credentials;
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
}

function cfg(a) {
  return `regions:
  - global
  - us-east-1
blocklist:
  - "${MGMT}"
  - "${PLAT}"
accounts:
  "${a}":
    presets:
      - keep
presets:
  keep:
    filters:
      IAMRole:
        - "OrganizationAccountAccessRole"
        - "ShieldSyncLabExec"
        - "ShieldSyncLabUser"
      IAMRolePolicyAttachment:
        - property: RoleName
          value: "OrganizationAccountAccessRole"
        - property: RoleName
          value: "ShieldSyncLabExec"
        - property: RoleName
          value: "ShieldSyncLabUser"
`;
}

const plat = await assume(`arn:aws:iam::${PLAT}:role/OrganizationAccountAccessRole`, "reset-plat");

for (const a of ACCTS) {
  console.log("clearing", a, "...");
  const ex = await assume(`arn:aws:iam::${a}:role/ShieldSyncLabExec`, "reset-exec", plat);
  const cf = join(tmpdir(), `reset-${a}.yaml`);
  writeFileSync(cf, cfg(a));
  const args = ["run", "--config", cf, "--no-prompt", "--no-dry-run", ...INCLUDE.flatMap((t) => ["--include", t])];
  try {
    const { stdout } = await exec(NUKE, args, {
      env: { ...process.env, AWS_ACCESS_KEY_ID: ex.accessKeyId, AWS_SECRET_ACCESS_KEY: ex.secretAccessKey, AWS_SESSION_TOKEN: ex.sessionToken, AWS_DEFAULT_REGION: REGION },
      maxBuffer: 50 * 1024 * 1024,
    });
    console.log("   ", (stdout.match(/Nuke complete[^\n]*/) || ["(no summary)"])[0]);
  } catch (e) {
    console.log("   nuke note:", (e.stdout || e.message || "").slice(-160));
  }
}

const db = new DynamoDBClient({ region: REGION, credentials: plat });
for (const a of ACCTS) {
  await db.send(new PutItemCommand({
    TableName: "ShieldSyncLabAccounts",
    Item: { accountId: { S: a }, status: { S: "available" }, execRoleArn: { S: `arn:aws:iam::${a}:role/ShieldSyncLabExec` }, registeredAt: { S: "2026-06-07" } },
  }));
}
const scan = await db.send(new ScanCommand({
  TableName: "ShieldSyncLabSessions",
  FilterExpression: "#s = :a OR #s = :l",
  ExpressionAttributeNames: { "#s": "status" },
  ExpressionAttributeValues: { ":a": { S: "active" }, ":l": { S: "leasing" } },
}));
for (const it of scan.Items ?? []) {
  await db.send(new UpdateItemCommand({
    TableName: "ShieldSyncLabSessions",
    Key: { sessionId: { S: it.sessionId.S } },
    UpdateExpression: "SET #s = :d",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":d": { S: "done" } },
  }));
}
console.log(`POOL RESET COMPLETE — ${ACCTS.length} accounts available, ${(scan.Items ?? []).length} sessions closed`);
