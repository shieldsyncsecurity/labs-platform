// One-shot (OPERATOR-RUN): create the HR portal's ENCRYPTED KYC storage in the
// platform account (750294427884). This is a step ABOVE the enterprise docs
// bucket (which uses SSE-S3): KYC is DPDP "sensitive personal data", so it gets
// its OWN customer-managed KMS key (auditable + revocable kill-switch) and its
// OWN bucket, never mixed with customer/labs data.
//
//   1. KMS CMK  alias/shieldsync-hr-kyc     (rotation ON)
//   2. S3       shieldsync-hr-kyc-750294427884
//        - default encryption: SSE-KMS with the CMK (BucketKeyEnabled)
//        - BlockPublicAccess: ALL on
//        - Versioning: ENABLED (accidental-overwrite guard for legal records)
//   3. Patches deploy/policy-hr.json with the real key ARN (least-privilege).
//
//   node create-hr-kyc-infra.mjs
//
// Run BEFORE .\deploy\deploy-hr.ps1 (which applies the patched policy).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  KMSClient,
  CreateKeyCommand,
  CreateAliasCommand,
  ListAliasesCommand,
  DescribeKeyCommand,
  EnableKeyRotationCommand,
} from "@aws-sdk/client-kms";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketVersioningCommand,
  PutBucketEncryptionCommand,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const ALIAS = "alias/shieldsync-hr-kyc";
const BUCKET = `shieldsync-hr-kyc-${PLATFORM}`;
const __dir = path.dirname(fileURLToPath(import.meta.url));

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-hr-kyc-infra",
    }),
  )
).Credentials;
const credentials = {
  accessKeyId: cred.AccessKeyId,
  secretAccessKey: cred.SecretAccessKey,
  sessionToken: cred.SessionToken,
};
const kms = new KMSClient({ region: REGION, credentials });
const s3 = new S3Client({ region: REGION, credentials });

// -- KMS CMK (idempotent via alias) -------------------------------------------
let keyId, keyArn;
const aliases = await kms.send(new ListAliasesCommand({}));
const found = (aliases.Aliases ?? []).find((a) => a.AliasName === ALIAS);
if (found?.TargetKeyId) {
  keyId = found.TargetKeyId;
  const d = await kms.send(new DescribeKeyCommand({ KeyId: keyId }));
  keyArn = d.KeyMetadata.Arn;
  console.log(`${ALIAS} already exists -> ${keyArn}`);
} else {
  const created = await kms.send(
    new CreateKeyCommand({
      Description: "ShieldSync HR KYC encryption (DPDP sensitive personal data)",
      KeyUsage: "ENCRYPT_DECRYPT",
      KeySpec: "SYMMETRIC_DEFAULT",
      Tags: [{ TagKey: "app", TagValue: "shieldsync-hr" }],
    }),
  );
  keyId = created.KeyMetadata.KeyId;
  keyArn = created.KeyMetadata.Arn;
  await kms.send(new CreateAliasCommand({ AliasName: ALIAS, TargetKeyId: keyId }));
  await kms.send(new EnableKeyRotationCommand({ KeyId: keyId }));
  console.log(`Created CMK ${keyArn} (alias ${ALIAS}, rotation ON).`);
}

// -- S3 bucket (idempotent) ---------------------------------------------------
let exists = false;
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  exists = true;
  console.log(`${BUCKET} already exists.`);
} catch (e) {
  if (e.name !== "NotFound" && e.$metadata?.httpStatusCode !== 404 && e.$metadata?.httpStatusCode !== 403) throw e;
}
if (!exists) {
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET })); // us-east-1: no LocationConstraint
  console.log(`Created s3://${BUCKET}.`);
}

await s3.send(
  new PutPublicAccessBlockCommand({
    Bucket: BUCKET,
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    },
  }),
);
console.log("  Block-public-access: all ON.");

await s3.send(new PutBucketVersioningCommand({ Bucket: BUCKET, VersioningConfiguration: { Status: "Enabled" } }));
console.log("  Versioning: ENABLED.");

await s3.send(
  new PutBucketEncryptionCommand({
    Bucket: BUCKET,
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: keyArn },
          BucketKeyEnabled: true,
        },
      ],
    },
  }),
);
console.log("  Default encryption: SSE-KMS (dedicated CMK), BucketKey ON.");

// Lifecycle: noncurrent versions expire after 30 days. Versioning stays ON as
// the accidental-overwrite guard, but an audited DELETE must become REAL
// erasure — the handler purges versions explicitly, and this rule is the
// backstop so nothing lingers indefinitely (DPDP erasure for sensitive data).
await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "expire-noncurrent-versions",
          Status: "Enabled",
          Filter: { Prefix: "" },
          NoncurrentVersionExpiration: { NoncurrentDays: 30 },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
        },
      ],
    },
  }),
);
console.log("  Lifecycle: noncurrent versions expire after 30 days.");

// -- DynamoDB SSE with the same CMK (re-asserted every run) --------------------
// PAN / bank / salary / snapshots / audit deserve the same auditable, revocable
// key as the KYC files — not the AWS-owned default.
const ddb = new DynamoDBClient({ region: REGION, credentials });
for (const table of ["ShieldSyncHrEmployees", "ShieldSyncHrDocuments", "ShieldSyncHrAudit"]) {
  try {
    const d = await ddb.send(new DescribeTableCommand({ TableName: table }));
    const sse = d.Table?.SSEDescription;
    if (sse?.SSEType === "KMS" && sse?.KMSMasterKeyArn === keyArn) {
      console.log(`  ${table}: already SSE-KMS with the HR CMK.`);
      continue;
    }
    await ddb.send(
      new UpdateTableCommand({
        TableName: table,
        SSESpecification: { Enabled: true, SSEType: "KMS", KMSMasterKeyId: keyArn },
      }),
    );
    console.log(`  ${table}: SSE-KMS enabled with the HR CMK.`);
  } catch (e) {
    console.log(`  ${table}: SSE update skipped (${e.name}) — run create-hr-tables.mjs first.`);
  }
}

// -- Patch policy-hr.json with the real key ARN (least-privilege) -------------
const policyPath = path.join(__dir, "deploy", "policy-hr.json");
const before = readFileSync(policyPath, "utf8");
const after = before.replace(/arn:aws:kms:us-east-1:750294427884:key\/[A-Za-z0-9_-]+/, keyArn);
if (after !== before) {
  writeFileSync(policyPath, after);
  console.log(`  Patched deploy/policy-hr.json KMS Resource -> ${keyArn}`);
} else {
  console.log("  deploy/policy-hr.json already carries a key ARN (left as-is).");
}

console.log(`\nKYC storage ready.\n  HR_KYC_BUCKET=${BUCKET}\n  HR_KMS_KEY_ID=${keyArn}\nNext: .\\deploy\\deploy-hr.ps1`);
