// One-shot (OPERATOR-RUN): create the session-recording bucket in the platform
// account (750294427884):
//
//   S3 bucket shieldsync-ent-recordings-750294427884 — webcam snapshots (JPEG)
//   + mic audio chunks (WebM/Opus) captured during live assessments, uploaded
//   DIRECTLY from the candidate's browser via presigned PUTs (see recinfra.mjs).
//     - PRIVATE (BlockPublicAccess all-on) + SSE-S3 default encryption.
//     - CORS: presigned PUTs are fetch()ed from the enterprise app origin, so
//       PUT must be allowed for it (plus localhost:3002 for dev). Playback uses
//       <img>/<audio> tags (no CORS needed) but GET is allowed for future use.
//     - LIFECYCLE: expire objects after 730 days — matches the "results retained
//       24 months" line the candidate consents to. The PII-erase cascade deletes
//       a candidate's prefix immediately on request, independent of this.
//     - NO versioning (unlike the docs bucket): recordings are append-only
//       evidence, not legal records; versioning would keep "deleted" faces.
//
//   node create-ent-recordings-infra.mjs
//
// AFTER this exists, the ENTERPRISE Lambda's IAM policy needs (added to
// deploy/policy-ent.json in this change; re-apply via deploy-ent.ps1 step 2):
//   s3:PutObject/GetObject/DeleteObject on arn:aws:s3:::shieldsync-ent-recordings-.../*
//   s3:ListBucket on the bucket itself.

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketEncryptionCommand,
} from "@aws-sdk/client-s3";

const REGION = "us-east-1";
const PLATFORM = "750294427884";
const BUCKET = `shieldsync-ent-recordings-${PLATFORM}`;
const APP_ORIGINS = ["https://enterprise.shieldsyncsecurity.com", "http://localhost:3002"];

const sts = new STSClient({ region: REGION });
const cred = (
  await sts.send(
    new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${PLATFORM}:role/OrganizationAccountAccessRole`,
      RoleSessionName: "create-ent-recordings-infra",
    })
  )
).Credentials;
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: cred.AccessKeyId,
    secretAccessKey: cred.SecretAccessKey,
    sessionToken: cred.SessionToken,
  },
});

// -- bucket (idempotent) -------------------------------------------------------
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  console.log(`${BUCKET} already exists.`);
} catch (e) {
  const status = e?.$metadata?.httpStatusCode;
  if (status !== 404 && e?.name !== "NotFound") throw e;
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  console.log(`${BUCKET} created.`);
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
  })
);
console.log("BlockPublicAccess: all-on.");

await s3.send(
  new PutBucketEncryptionCommand({
    Bucket: BUCKET,
    ServerSideEncryptionConfiguration: {
      Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
    },
  })
);
console.log("SSE-S3 default encryption on.");

await s3.send(
  new PutBucketCorsCommand({
    Bucket: BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: APP_ORIGINS,
          AllowedMethods: ["PUT", "GET"],
          AllowedHeaders: ["content-type"],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  })
);
console.log(`CORS: PUT/GET from ${APP_ORIGINS.join(", ")}.`);

await s3.send(
  new PutBucketLifecycleConfigurationCommand({
    Bucket: BUCKET,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: "expire-recordings-24mo",
          Status: "Enabled",
          Filter: { Prefix: "rec/" },
          Expiration: { Days: 730 },
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
        },
      ],
    },
  })
);
console.log("Lifecycle: expire after 730 days.");

console.log(`\nDone. Bucket ready: ${BUCKET}`);
