## The scenario

A small team shipped fast and left their S3 estate exposed. Two buckets are
world-readable, neither enforces encryption or HTTPS, and a service account has
`s3:*` on every resource. Your job: **find the problems and fix them in place.**

## What you'll do

You'll close **four real misconfigurations** — public buckets, missing encryption, non-TLS access, and an over-broad IAM user — and verify each fix with **Check my work** (panel on the right).

**Launch the lab** (panel on the right) to spin up your own isolated AWS account — the full step-by-step walkthrough unlocks the moment it's ready.

<!-- ss:walkthrough -->

:::refcard
**Your environment** — the real resource names appear here once your lab is live.

| Role | Name |
|---|---|
| Public via **policy** | `DataBucketName` |
| Public via **ACL** | `AssetsBucketName` |
| Over-privileged user | `auditor` (path `/lab/`) |

⚠️ **Don't delete the buckets** — you're graded on *fixing* them in place, not removing them.
:::

## Step 1 — Recon: prove the exposure

First, see what's exposed — no fixes yet, just confirm the problem.

🖱️ **Console**

1. **Open S3 and spot the public buckets.** The list flags both `sslab-data-…` and `sslab-assets-…` as **Publicly accessible**.

   >> S3 › Buckets

2. **Inspect the data bucket — public via a bucket policy.**

   >> S3 › data bucket › Permissions

   Note **Block public access = Off** and a **Bucket policy** that grants public read.

3. **Inspect the assets bucket — public via an ACL.**

   >> S3 › assets bucket › Permissions

   Under **Object Ownership**, the ACL grants access to **Everyone (public access)**.

⌨️ **CLI (CloudShell):**

```bash
aws s3api list-buckets --query "Buckets[?starts_with(Name,'sslab-')].Name"
aws s3api get-bucket-policy-status --bucket <data-bucket>      # -> IsPublic: true
aws s3api get-bucket-acl          --bucket <assets-bucket>     # -> a grant to AllUsers
```

Prove anonymous read actually works — no credentials needed:

```bash
curl -s "https://<data-bucket>.s3.amazonaws.com/customers.csv"   # you'll see the fake data
```

## Step 2 — Shut the public access
<!-- ss:obj=no-public-buckets -->

Belt **and** braces: turn on **Block Public Access** at the **account** level (catches
future mistakes too) and the **bucket** level, then remove the actual public grants.

🖱️ **Console**

1. **Turn on the account-wide guardrail first** — it catches future mistakes too.

   >> S3 › Block Public Access settings for this account

   Click [[Edit]], tick **all four** boxes, then [[Save]] (type `confirm`).

2. **Remove the public policy on the data bucket.**

   >> S3 › data bucket › Permissions › Bucket policy

   Click [[Delete]].

3. **Kill the public ACL on the assets bucket.**

   >> S3 › assets bucket › Permissions › Object Ownership

   Click [[Edit]], choose **ACLs disabled (Bucket owner enforced)**, then [[Save]].

4. **Block Public Access on each bucket** (do **both**).

   >> S3 › each bucket › Permissions › Block public access (bucket settings)

   Click [[Edit]], tick **all four**, then [[Save]].

⌨️ **CLI:**

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

Re-run the `curl` from Step 1 — it should now be **AccessDenied**. ✅

## Step 3 — Require encryption at rest
<!-- ss:obj=encryption-required -->

Turn on default encryption **and** add a bucket policy that *rejects* any unencrypted
upload (the grader looks for the explicit **Deny**). Here you flip on default encryption;
the matching **Deny** ships in Step 4's combined policy.

🖱️ **Console**

1. **Turn on default encryption for each bucket.**

   >> S3 › each bucket › Properties › Default encryption

   Click [[Edit]], choose **SSE-S3 (Amazon S3 managed keys)**, then [[Save]].

⌨️ **CLI:**

```bash
aws s3api put-bucket-encryption --bucket <bucket> \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

The Deny statement (included in Step 4's combined policy):

```json
{ "Sid":"DenyUnEncryptedPuts","Effect":"Deny","Principal":"*",
  "Action":"s3:PutObject","Resource":"arn:aws:s3:::<bucket>/*",
  "Condition":{"StringNotEquals":{"s3:x-amz-server-side-encryption":["AES256","aws:kms"]}} }
```

## Step 4 — Require TLS (HTTPS) — and apply the combined policy
<!-- ss:obj=encryption-required,tls-only -->

One hardened bucket policy carries **both** the encryption-required and TLS-only denies.

🖱️ **Console**

1. **Apply the hardened bucket policy to each bucket.**

   >> S3 › each bucket › Permissions › Bucket policy

   Click [[Edit]], paste the JSON below (replace every `<bucket>` with that bucket's name), then [[Save changes]].

⌨️ **CLI:** save it as `secure-policy.json`, then apply to **each** bucket:

```bash
aws s3api put-bucket-policy --bucket <bucket> --policy file://secure-policy.json
```

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

## Step 5 — Least-privilege the IAM user
<!-- ss:obj=least-privilege-iam -->

`auditor` should only read the two lab buckets — not `s3:*` on everything.

🖱️ **Console**

1. **Remove the over-broad inline policy.**

   >> IAM › Users › auditor › Permissions

   Expand **`s3-full-access-everywhere`** and click [[Remove]].

2. **Add a scoped read-only policy instead.**

   >> IAM › Users › auditor › Add permissions › Create inline policy

   Open the **JSON** tab, paste the scoped policy below, click [[Next]], name it `s3-read-lab-buckets`, then [[Create policy]].

⌨️ **CLI:**

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

## Check your work

Click **Check my work** in the right-hand panel — it inspects your **live** account
against the four objectives and shows ✅ / ⬜ per item. If something's still ⬜, the
matching step above tells you what's left open. Prefer to spot-check yourself?

🖱️ **Console**

- Each bucket's list row now reads **Not public**.
- **IAM › Users › auditor** shows only the scoped `s3-read-lab-buckets` policy.

⌨️ **CLI:**

```bash
aws s3api get-bucket-policy-status --bucket <bucket>          # IsPublic: false (both)
aws iam list-user-policies        --user-name auditor        # no 's3-full-access-everywhere'
aws iam get-user-policy --user-name auditor --policy-name s3-read-lab-buckets   # scoped, no "*"
```

## Hints

- The bucket list's **"Publicly accessible"** flag (and `get-bucket-policy-status`) is the fastest "is it public?" check.
- **Account-level** Block Public Access overrides any bucket that tries to be public — it's your strongest single control.
- Default encryption ≠ *required* encryption. Only the `Deny` policy forces callers to ask for it.
- Scope IAM to the buckets, not to `*` — wildcards are how one leaked key becomes a full breach.

## Cleanup

Nothing to do — when your session ends, the entire account is automatically wiped clean. There's no bill to worry about.
