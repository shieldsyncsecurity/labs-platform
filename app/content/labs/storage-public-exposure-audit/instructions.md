## The scenario

A team spun up an Azure Storage account to share a data export and left the door
wide open. The account permits **anonymous blob access**, doesn't require
**HTTPS**, and still allows **account-key (Shared Key) access**. A container named `public-data` is set to
anonymous read and holds a "secret" file anyone on the internet can pull down. Your
job: **find the problems and fix them in place.**

## What you'll fix

- **Public blob access** — the account allows anonymous reads, and `public-data` is exposed
- **No secure transfer** — HTTPS isn't enforced, so plaintext HTTP is accepted
- **Shared Key access on** — data can be reached with the account keys instead of Microsoft Entra ID

Each fix is checked live against your storage account by **Check my work**.

<!-- ss:walkthrough -->

:::refcard
**Your environment** — the real resource names appear here once your lab is live.

| Role | Name |
|---|---|
| Storage account | `StorageAccountName` |
| Public container | `public-data` |
| Seeded "secret" object | `customer-export.csv` |
| Anonymous blob URL | `AnonymousBlobUrl` |

⚠️ **Don't delete the storage account or container** — you're graded on *fixing* the
configuration in place, not removing the resources.
:::

## Step 1 — Recon: prove the exposure

First, see what's exposed — no fixes yet, just confirm the three problems.

🖱️ **Portal**

1. **Open the storage account and check its anonymous-access setting.**

   >> Storage accounts › your account › Settings › Configuration

   Note **Allow Blob anonymous access = Enabled**, **Secure transfer required = Disabled**,
   and **Allow storage account key access = Enabled**. All three are wrong.

2. **Confirm the container is publicly readable.**

   >> Storage accounts › your account › Data storage › Containers › `public-data`

   The **Public access level** column reads **Blob (anonymous read access for blobs only)**.

⌨️ **CLI (az):**

```bash
RG=<your-resource-group>
ACCT=<your-storage-account>

az storage account show -g "$RG" -n "$ACCT" \
  --query "{anonBlob:allowBlobPublicAccess, httpsOnly:enableHttpsTrafficOnly, sharedKey:allowSharedKeyAccess}"
# -> anonBlob: true, httpsOnly: false, sharedKey: true   (all three are the problem)

az storage container show-permission -n public-data --account-name "$ACCT" --auth-mode login
# -> "publicAccess": "blob"
```

Prove anonymous read actually works — no credentials, no token, just the public URL:

```bash
curl -s "https://<your-account>.blob.core.windows.net/public-data/customer-export.csv"
# you'll see the fake export data — that's the leak
```

## Step 2 — Block anonymous blob access
<!-- ss:obj=no-anonymous-blob-access -->

Belt **and** braces: flip the **account-level** switch off (this alone makes any
anonymous GET return **409 PublicAccessNotPermitted**), then also set the container
back to **private** so nothing advertises itself as public.

🖱️ **Portal**

1. **Turn off anonymous access at the account level.**

   >> Storage accounts › your account › Settings › Configuration

   Set **Allow Blob anonymous access** to **Disabled**, then click [[Save]].

2. **Set the container's public access level back to private.**

   >> Storage accounts › your account › Data storage › Containers › `public-data`

   Click [[Change access level]], choose **Private (no anonymous access)**, then [[OK]].

⌨️ **CLI:**

```bash
# Account-level switch — the decisive fix
az storage account update -g "$RG" -n "$ACCT" --allow-blob-public-access false

# Belt-and-braces: reset the container to private
az storage container set-permission -n public-data --account-name "$ACCT" \
  --auth-mode login --public-access off
```

Re-run the `curl` from Step 1 — it should now fail with **409 / PublicAccessNotPermitted**
instead of returning the file. ✅

## Step 3 — Require secure transfer (HTTPS-only)
<!-- ss:obj=secure-transfer-required -->

With **Secure transfer required** on, the account rejects any request that isn't HTTPS,
so credentials and data can't cross the wire in plaintext.

🖱️ **Portal**

1. **Enable secure transfer.**

   >> Storage accounts › your account › Settings › Configuration

   Set **Secure transfer required** to **Enabled**, then click [[Save]].

⌨️ **CLI:**

```bash
az storage account update -g "$RG" -n "$ACCT" --https-only true
```

## Step 4 — Disable Shared Key (account-key) access
<!-- ss:obj=shared-key-access-disabled -->

Account keys are all-powerful, RBAC-bypassing credentials — if one leaks, the whole
account is exposed. Best practice is to turn off Shared Key access so every request
must authenticate with **Microsoft Entra ID** instead.

🖱️ **Portal**

1. **Turn off account-key access.**

   >> Storage accounts › your account › Settings › Configuration

   Set **Allow storage account key access** to **Disabled**, then click [[Save]].

⌨️ **CLI:**

```bash
az storage account update -g "$RG" -n "$ACCT" --allow-shared-key-access false
```

---

## Check your work

Click **Check my work** in the right-hand panel — it inspects your **live** storage
account against the three objectives and shows ✅ / ⬜ per item. It also runs an
unauthenticated GET on the blob URL to confirm the leak is actually closed, not just the
setting flipped. If something's still ⬜, the matching step above tells you what's left
open. Prefer to spot-check yourself?

🖱️ **Portal**

- **Configuration** shows anonymous access **Disabled**, secure transfer **Enabled**, account-key access **Disabled**.
- The `public-data` container's access level reads **Private**.

⌨️ **CLI:**

```bash
az storage account show -g "$RG" -n "$ACCT" \
  --query "{anonBlob:allowBlobPublicAccess, httpsOnly:enableHttpsTrafficOnly, sharedKey:allowSharedKeyAccess}"
# -> anonBlob: false, httpsOnly: true, sharedKey: false

curl -s -o /dev/null -w "%{http_code}\n" \
  "https://<your-account>.blob.core.windows.net/public-data/customer-export.csv"
# -> 409 (no longer 200)
```

## Hints

- The **Configuration** blade shows all three account-level flags on one screen — start there.
- Turning off **Allow Blob anonymous access** at the account level overrides any container that's set to public — it's your strongest single control, and it's what closes the leak.
- A container set to **Blob** or **Container** access only matters *while* the account allows anonymous access. Fixing the account setting neutralises it, but setting the container to **Private** too keeps the config honest.
- Enabling **Secure transfer required** doesn't change the blob URL — it just refuses the plaintext HTTP version of it.
- Disabling **Allow storage account key access** forces every client to authenticate with Microsoft Entra ID — the account keys stop working, so make sure nothing legitimately relies on them first.

## Cleanup

Nothing to do — your environment is wiped clean automatically.
