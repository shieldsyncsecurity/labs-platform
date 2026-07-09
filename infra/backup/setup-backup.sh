#!/usr/bin/env bash
# ShieldSync backup infrastructure — one-time (idempotent) setup.
#
# Creates, in the platform account 750294427884:
#   - S3 bucket  shieldsync-backups-750294427884  in us-west-2 (CROSS-REGION from
#     the us-east-1 data), versioned + SSE + public-access-blocked, with a
#     lifecycle: Deep Archive after 90 days, expire after 730 days.
#   - IAM role   ShieldSyncBackupRole              (Lambda -> export + write bucket)
#   - Lambda     ShieldSyncBackupExporter          (us-east-1, nodejs22, the exporter)
#   - EventBridge rule ShieldSyncDailyBackup       rate(1 day) -> the Lambda
#
# Run with credentials for account 750 already in the environment (assume
# OrganizationAccountAccessRole first). Re-running is safe — every step checks
# before creating. See DR-RUNBOOK.md for what this protects and how to restore.
set -euo pipefail

ACCOUNT=750294427884
DATA_REGION=us-east-1          # where the DynamoDB tables live + where the Lambda runs
BACKUP_REGION=us-west-2        # where the backups live (a different region)
BUCKET=shieldsync-backups-${ACCOUNT}
ROLE=ShieldSyncBackupRole
FN=ShieldSyncBackupExporter
RULE=ShieldSyncDailyBackup
# cd into the script dir and use RELATIVE file:// paths — the Windows aws CLI
# cannot read Git Bash '/c/...' MSYS paths, but relative paths resolve fine.
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "== 1/5 S3 backup bucket ($BUCKET in $BACKUP_REGION) =="
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  bucket exists"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$BACKUP_REGION" \
    --create-bucket-configuration LocationConstraint="$BACKUP_REGION" >/dev/null
  echo "  created"
fi
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "shieldsync-backup-retention",
    "Filter": {"Prefix": "exports/"},
    "Status": "Enabled",
    "Transitions": [{"Days": 90, "StorageClass": "DEEP_ARCHIVE"}],
    "Expiration": {"Days": 730},
    "NoncurrentVersionExpiration": {"NoncurrentDays": 30}
  }]
}'
echo "  versioning + SSE + block-public + lifecycle applied"

echo "== 2/5 IAM role ($ROLE) =="
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "  role exists"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null
  echo "  created"
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name ShieldSyncBackupPolicy \
  --policy-document "file://iam-backup-policy.json"
echo "  policy applied"

echo "== 3/5 package the Lambda =="
rm -f backup-exporter.zip
# python zipfile (portable — no `zip` binary needed) with the handler at the
# archive root so Lambda's "backup-exporter.handler" resolves.
python -c "import zipfile; z=zipfile.ZipFile('backup-exporter.zip','w',zipfile.ZIP_DEFLATED); z.write('backup-exporter.mjs','backup-exporter.mjs'); z.close()"
echo "  zipped $(du -h backup-exporter.zip | cut -f1)"

echo "== 4/5 Lambda ($FN in $DATA_REGION) =="
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
ENV="Variables={BACKUP_BUCKET=$BUCKET,BACKUP_BUCKET_OWNER=$ACCOUNT,SOURCE_REGION=$DATA_REGION,TABLE_PREFIX=ShieldSync}"
if aws lambda get-function --function-name "$FN" --region "$DATA_REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --region "$DATA_REGION" \
    --zip-file "fileb://backup-exporter.zip" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$DATA_REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$DATA_REGION" \
    --timeout 300 --environment "$ENV" >/dev/null
  echo "  updated"
else
  # give IAM a moment to propagate the new role before Lambda validates it
  sleep 10
  aws lambda create-function --function-name "$FN" --region "$DATA_REGION" \
    --runtime nodejs22.x --role "$ROLE_ARN" --handler backup-exporter.handler \
    --timeout 300 --memory-size 256 --zip-file "fileb://backup-exporter.zip" \
    --environment "$ENV" >/dev/null
  echo "  created"
fi
aws lambda wait function-updated --function-name "$FN" --region "$DATA_REGION"

echo "== 5/5 EventBridge daily schedule ($RULE) =="
aws events put-rule --name "$RULE" --region "$DATA_REGION" \
  --schedule-expression "rate(1 day)" --state ENABLED \
  --description "ShieldSync daily DynamoDB backup export" >/dev/null
FN_ARN="arn:aws:lambda:${DATA_REGION}:${ACCOUNT}:function:${FN}"
aws lambda add-permission --function-name "$FN" --region "$DATA_REGION" \
  --statement-id "${RULE}-invoke" --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "arn:aws:events:${DATA_REGION}:${ACCOUNT}:rule/${RULE}" >/dev/null 2>&1 || echo "  (invoke permission already present)"
aws events put-targets --rule "$RULE" --region "$DATA_REGION" \
  --targets "Id=1,Arn=${FN_ARN}" >/dev/null
echo "  daily rule wired to the Lambda"

echo ""
echo "DONE. Backups: s3://$BUCKET/exports/<date>/<table>/ in $BACKUP_REGION."
echo "Trigger a test run now:  aws lambda invoke --function-name $FN --region $DATA_REGION /tmp/out.json && cat /tmp/out.json"
