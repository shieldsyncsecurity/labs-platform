# S3 Misconfiguration & Data Exposure

**Level:** Beginner · **Free lab** · **~30 min** · Region: us-east-1

## Before you start — your workspace (30-second read)

You've got two things side by side:

- **This guide** — the scenario, the steps, and the **Check my work** button (right-hand panel).
- **A real, throwaway AWS account** — yours for this session, wiped clean when you finish. Nothing here can cost money or touch anything real, so click around freely.

**To open your AWS account:** click **Open AWS console** (top of the right panel). It opens the real AWS Console in a **new browser tab**.

> ⚠️ **AWS allows only one console session per browser.** If you're already signed into your *own* AWS account, the lab tab will say *"you must log out first."* Two easy fixes: open the lab console in an **incognito / private window** (use the **Copy URL for incognito** button next to the console link), or sign out of your own AWS first. This trips up almost everyone once — it's not you.

**There are two ways to do every fix below — pick your style with the `🖱️ Console / ⌨️ CLI` switch at the top of this guide, and switch anytime:**
- **🖱️ Console** — point-and-click in the AWS web UI. Best if you're newer to AWS.
- **⌨️ CLI** — run commands in **CloudShell** (the `>_` terminal icon in the AWS console's top bar — no setup, already signed in as you). Faster once you're comfortable.

When you've made the fixes, come back here and click **Check my work** — it inspects your *live* account and shows, per objective, what's done and what's left.

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

First, see what's exposed.

🖱️ **Console:** open the **S3** service. You'll see buckets named `sslab-data-…` and `sslab-assets-…`. Click the **data** bucket → **Permissions** tab → notice **"Block public access" = Off** and a **Bucket policy** that grants public read. Then the **assets** bucket → **Permissions** → its **Object Ownership / ACL** grants access to **"Everyone (public access)."** In the bucket list, AWS even flags both as **"Publicly accessible."**

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

Belt **and** braces: turn on **Block Public Access** at the **account** level (catches
future mistakes too) and the **bucket** level, then remove the actual public grants.

🖱️ **Console:**
1. **Account-wide guardrail:** S3 console → left nav → **"Block Public Access settings for this account"** → **Edit** → tick **all four** boxes → **Save** (type `confirm`).
2. **Data bucket — remove the public policy:** S3 → the **data** bucket → **Permissions** → **Bucket policy** → **Delete**.
3. **Assets bucket — kill the public ACL:** S3 → the **assets** bucket → **Permissions** → **Object Ownership** → **Edit** → choose **"ACLs disabled (Bucket owner enforced)"** → **Save**.
4. **Per-bucket Block Public Access (do BOTH buckets):** each bucket → **Permissions** → **Block public access (bucket settings)** → **Edit** → tick **all four** → **Save**.

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

Turn on default encryption **and** add a bucket policy that *rejects* any unencrypted
upload (the grader looks for the explicit **Deny**).

🖱️ **Console:** each bucket → **Properties** tab → **Default encryption** → **Edit** → **Server-side encryption with Amazon S3 managed keys (SSE-S3)** → **Save**. (The "reject unencrypted uploads" **Deny** goes in the bucket policy you'll set in Step 4.)

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

One hardened bucket policy carries **both** the encryption-required and TLS-only denies.

🖱️ **Console:** each bucket → **Permissions** → **Bucket policy** → **Edit** → paste the JSON below (replace every `<bucket>` with that bucket's name) → **Save changes**.

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

`auditor` should only read the two lab buckets — not `s3:*` on everything.

🖱️ **Console:** open the **IAM** service → **Users** → **auditor** → **Permissions** tab. Find the inline policy named **`s3-full-access-everywhere`** → expand it → **Remove**. Then **Add permissions** → **Create inline policy** → **JSON** tab → paste the scoped policy below → **Next** → name it `s3-read-lab-buckets` → **Create policy**.

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
matching step above tells you what's left open. (Prefer to spot-check yourself?)

🖱️ **Console:** each bucket's list row should now read **"Not public"**; IAM → auditor shows only the scoped `s3-read-lab-buckets` policy.

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

Nothing to do — when your session ends the account is wiped (`aws-nuke`) and returned to the pool. There's no bill to worry about.
