# KMS & data protection

**Level:** Beginner · **Est. active time:** ~30 min · **Region:** us-east-1

---

## The scenario

The data team stood up an **"encrypted" S3 bucket** for sensitive customer exports
(`sslab-kms-exports-…`). On paper it's locked down: there's a dedicated KMS key
(`alias/shieldsync-lab-exports`) and the bucket has default SSE-KMS turned on.

In practice, the protection is **theatre**:

1. An IAM user **`data-analyst`** — "just someone who reads the exports" — has been
   granted **`kms:*` on every key in the account**. That includes
   `kms:ScheduleKeyDeletion` and `kms:DisableKey`: this "analyst" can **delete the
   key and destroy every object** the moment they want to, or quietly read
   anything encrypted under any key.
2. The bucket's encryption is **default, not enforced**. A client can override the
   default on upload and store objects with weak SSE-S3, *no* encryption, or push
   them over **plain HTTP**. Encryption you don't enforce isn't encryption you can
   trust.

Your job: make the protection real.

## Your mission (the grader checks these)

| # | Objective | Done when |
|---|-----------|-----------|
| 1 | **Least privilege on the key** | `/lab/data-analyst` no longer holds `kms:*` on `*` — it has `kms:Decrypt` on the **one** lab key ARN and nothing more. |
| 2 | **Enforce encryption** | The bucket policy **Denies** any `PutObject` that isn't SSE-KMS with the lab key, **and Denies** any request where `aws:SecureTransport = false`. |

---

## Step by step

### 1 — See the over-privilege

Open the **IAM console** (link in the lab panel) → Users → **`data-analyst`** →
the inline policy `analyst-overbroad`. Note the `KmsEverything` statement:
`Action: kms:*`, `Resource: *`. That single line is the whole problem.

```bash
aws iam get-user-policy --user-name data-analyst --policy-name analyst-overbroad
```

### 2 — Scope the analyst down

Replace the inline policy with least privilege. The analyst only needs to **read**
exports, so `kms:Decrypt` on the **specific** key, plus the bucket reads:

```bash
KEY_ARN=$(aws kms describe-key --key-id alias/shieldsync-lab-exports \
  --query 'KeyMetadata.Arn' --output text)
ACCT=$(aws sts get-caller-identity --query Account --output text)

aws iam put-user-policy --user-name data-analyst --policy-name analyst-overbroad \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      { \"Sid\": \"DecryptOneKey\", \"Effect\": \"Allow\",
        \"Action\": \"kms:Decrypt\", \"Resource\": \"$KEY_ARN\" },
      { \"Sid\": \"ReadExports\", \"Effect\": \"Allow\",
        \"Action\": [\"s3:GetObject\",\"s3:ListBucket\"],
        \"Resource\": [
          \"arn:aws:s3:::sslab-kms-exports-$ACCT\",
          \"arn:aws:s3:::sslab-kms-exports-$ACCT/*\" ] }
    ]
  }"
```

> No more `kms:*`, no more `Resource: *` — the analyst can read, and can't touch the key's lifecycle.

### 3 — Enforce encryption on the bucket

Default encryption fills the gap only when the client stays silent. Close it for
good with a bucket policy that **rejects** anything that isn't SSE-KMS with your
key, and anything not over TLS:

```bash
aws s3api put-bucket-policy --bucket sslab-kms-exports-$ACCT --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Sid\": \"DenyUnEncryptedUploads\", \"Effect\": \"Deny\",
      \"Principal\": \"*\", \"Action\": \"s3:PutObject\",
      \"Resource\": \"arn:aws:s3:::sslab-kms-exports-$ACCT/*\",
      \"Condition\": { \"StringNotEquals\": { \"s3:x-amz-server-side-encryption\": \"aws:kms\" } } },
    { \"Sid\": \"DenyWrongKey\", \"Effect\": \"Deny\",
      \"Principal\": \"*\", \"Action\": \"s3:PutObject\",
      \"Resource\": \"arn:aws:s3:::sslab-kms-exports-$ACCT/*\",
      \"Condition\": { \"StringNotEquals\": { \"s3:x-amz-server-side-encryption-aws-kms-key-id\": \"$KEY_ARN\" } } },
    { \"Sid\": \"DenyInsecureTransport\", \"Effect\": \"Deny\",
      \"Principal\": \"*\", \"Action\": \"s3:*\",
      \"Resource\": [
        \"arn:aws:s3:::sslab-kms-exports-$ACCT\",
        \"arn:aws:s3:::sslab-kms-exports-$ACCT/*\" ],
      \"Condition\": { \"Bool\": { \"aws:SecureTransport\": \"false\" } } }
  ]
}"
```

### 4 — Prove it

A plaintext or wrong-key upload should now be **rejected**:

```bash
# should FAIL (no SSE-KMS header):
echo secret > t.txt
aws s3api put-object --bucket sslab-kms-exports-$ACCT --key t.txt --body t.txt

# should SUCCEED (correct key):
aws s3api put-object --bucket sslab-kms-exports-$ACCT --key t.txt --body t.txt \
  --server-side-encryption aws:kms --ssekms-key-id "$KEY_ARN"
```

Then **Check my work** in the lab panel.

---

## Hints

- KMS access is the key policy **and** IAM together. The key policy here is the safe
  root-admin default — the flaw is purely the analyst's IAM grant.
- `kms:*` quietly includes destructive actions (`ScheduleKeyDeletion`,
  `DisableKey`, `PutKeyPolicy`). "Read-only" should never imply those.
- Default bucket encryption ≠ enforced encryption. The `Deny` on
  `s3:x-amz-server-side-encryption` is what actually enforces it.
- The `aws:SecureTransport=false` deny is a one-liner every bucket holding
  sensitive data should carry.

## Concepts

KMS key policy · IAM least privilege · `s3:x-amz-server-side-encryption` condition
keys · enforcing encryption in transit (`aws:SecureTransport`) and at rest.
