# S3 Misconfiguration & Data Exposure

**Level:** Beginner · **Free lab** · **~30 min** · Region: us-east-1

> You're working in your own throwaway AWS account. You have console + CloudShell
> access. Everything here is auto-destroyed when your session ends — experiment freely.

## Scenario

A small team shipped fast and left their S3 estate exposed. Two buckets are
world-readable, neither enforces encryption or HTTPS, and a service account has
`s3:*` on every resource. Your job: **find the problems and fix them in place.**

The Session Engine has filled in your environment's real names:

| What | Value |
|---|---|
| Public-via-**policy** bucket | `DataBucketName` |
| Public-via-**ACL** bucket | `AssetsBucketName` |
| Over-privileged user | `auditor` (path `/lab/`) |

> Don't delete the buckets — you're graded on **fixing** them, not removing them.

## Your mission (the grader checks these)

1. **No public buckets** — no anonymous read on any lab bucket.
2. **Encryption required** — each bucket denies unencrypted `PutObject`.
3. **TLS only** — each bucket denies non-HTTPS requests.
4. **Least-privilege IAM** — `auditor` no longer has `s3:*` on `*`.

---

## Step 1 — Recon: prove the exposure

```bash
# List your lab buckets
aws s3api list-buckets --query "Buckets[?starts_with(Name,'sslab-')].Name"

# Which are public? (run for each bucket)
aws s3api get-bucket-policy-status --bucket <data-bucket>      # -> IsPublic: true
aws s3api get-bucket-acl          --bucket <assets-bucket>     # -> a grant to AllUsers
```

Confirm anonymous read actually works (no credentials):

```bash
curl -s "https://<data-bucket>.s3.amazonaws.com/customers.csv"   # you'll see the fake data
```

## Step 2 — Shut the public access

Belt **and** braces — turn on Block Public Access at the **account** level (catches
future mistakes too) and the **bucket** level, then remove the actual public grants.

```bash
ACCT=$(aws sts get-caller-identity --query Account --output text)

# Account-wide guardrail
aws s3control put-public-access-block --account-id "$ACCT" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Remove the public BUCKET POLICY on the data bucket
aws s3api delete-bucket-policy --bucket <data-bucket>

# Kill the public ACL on the assets bucket: disable ACLs + reset to private
aws s3api put-bucket-ownership-controls --bucket <assets-bucket> \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'

# Per-bucket Block Public Access (do for BOTH buckets)
aws s3api put-public-access-block --bucket <bucket> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Re-run the `curl` from Step 1 — it should now be **AccessDenied**.

## Step 3 — Require encryption at rest

Turn on default encryption **and** add a bucket policy that *rejects* any
unencrypted upload (the grader looks for the explicit deny):

```bash
aws s3api put-bucket-encryption --bucket <bucket> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Add this statement to each bucket's policy (Step 4 shows the combined policy):

```json
{ "Sid":"DenyUnEncryptedPuts","Effect":"Deny","Principal":"*",
  "Action":"s3:PutObject","Resource":"arn:aws:s3:::<bucket>/*",
  "Condition":{"StringNotEquals":{"s3:x-amz-server-side-encryption":["AES256","aws:kms"]}} }
```

## Step 4 — Require TLS (HTTPS) — and apply the combined policy

A single hardened bucket policy can carry both the encryption and TLS denies.
Save as `secure-policy.json` (substitute the bucket name), then apply to **each** bucket:

```json
{ "Version":"2012-10-17","Statement":[
  { "Sid":"DenyUnEncryptedPuts","Effect":"Deny","Principal":"*",
    "Action":"s3:PutObject","Resource":"arn:aws:s3:::<bucket>/*",
    "Condition":{"StringNotEquals":{"s3:x-amz-server-side-encryption":["AES256","aws:kms"]}} },
  { "Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*",
    "Action":"s3:*","Resource":["arn:aws:s3:::<bucket>","arn:aws:s3:::<bucket>/*"],
    "Condition":{"Bool":{"aws:SecureTransport":"false"}} }
]}
```

```bash
aws s3api put-bucket-policy --bucket <bucket> --policy file://secure-policy.json
```

## Step 5 — Least-privilege the IAM user

`auditor` should only read the two lab buckets — not `s3:*` on everything.

```bash
# Remove the over-broad inline policy
aws iam delete-user-policy --user-name auditor --policy-name s3-full-access-everywhere

# Replace with a scoped one (save as scoped.json first)
aws iam put-user-policy --user-name auditor --policy-name s3-read-lab-buckets \
  --policy-document file://scoped.json
```

`scoped.json`:

```json
{ "Version":"2012-10-17","Statement":[
  { "Effect":"Allow","Action":["s3:GetObject","s3:ListBucket"],
    "Resource":["arn:aws:s3:::sslab-data-*","arn:aws:s3:::sslab-data-*/*",
                "arn:aws:s3:::sslab-assets-*","arn:aws:s3:::sslab-assets-*/*"] } ]}
```

---

## Verify you passed

```bash
aws s3api get-bucket-policy-status --bucket <bucket>          # IsPublic: false (both)
aws iam list-user-policies        --user-name auditor        # no 's3-full-access-everywhere'
aws iam get-user-policy --user-name auditor --policy-name s3-read-lab-buckets   # scoped, no "*"
```

## Hints

- `get-bucket-policy-status` is the fastest "is it public?" check.
- Account-level Block Public Access overrides any bucket that tries to be public — it's your strongest single control.
- Default encryption ≠ *required* encryption. Only the `Deny` policy forces callers to ask for it.
- Scope IAM to the buckets, not to `*` — wildcards are how one leaked key becomes a full breach.

## Cleanup

Nothing to do — when your session ends the account is wiped (`aws-nuke`) and returned to the pool. There's no bill to worry about.
