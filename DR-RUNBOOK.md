# ShieldSync — Disaster Recovery & Operations Runbook

**Purpose:** everything needed to back up, restore, and rebuild the whole ShieldSync
system **without any specific person or tool**. If you are reading this after a data
loss, a bad deploy, or an account problem — start at the scenario in §5 that matches.

Last verified: 2026-07-09. Keep this file current when infra changes.

> **Golden rule:** the *code and content* are all in Git (GitHub) and the *runtime data*
> is in DynamoDB (backed up two ways — see §2). Nothing that matters lives only on a
> laptop. Secrets live only in the owner's password manager (never in Git).

---

## 1. What the system is made of

| Piece | Where it runs | Source of truth | How it deploys |
|---|---|---|---|
| Marketing site (shieldsyncsecurity.com) | AWS Amplify, app `d2d3yptdwi41th`, acct 750, us-east-1 (static export) | `shieldsync-website` repo | push to `main` -> Amplify builds |
| Labs app (labs.shieldsyncsecurity.com) | Cloudflare Worker `labs-platform` | `labs-platform/app` | CI `deploy-labs.yml` on push to `master` (app/**) |
| Enterprise app (enterprise.shieldsyncsecurity.com) | Cloudflare Worker `enterprise-platform` | `labs-platform/enterprise` | CI `deploy-enterprise.yml` |
| B2C engine | Lambda `ShieldSyncEngine` (acct 750) + API GW | `labs-platform/engine` | `engine/deploy/deploy.ps1` |
| Enterprise engine | Lambda `ShieldSyncEnterpriseEngine` (acct 750) + API GW `bdkdcbhzme` | `labs-platform/engine` (ent-handler/entinfra) | `engine/deploy/deploy-ent.ps1` |
| Backup exporter | Lambda `ShieldSyncBackupExporter` (acct 750) + EventBridge `ShieldSyncDailyBackup` | `labs-platform/infra/backup` | `infra/backup/setup-backup.sh` |

**AWS Organization** `o-v0q5eumtob`:
- **851236938541** — "ShieldSync Labs" (management): Cognito user pools, the org, CLI creds `apiuserforclaude`.
- **750294427884** — "ShieldSync Platform": both engine Lambdas, ALL DynamoDB tables, the deploy + backup S3 buckets.
- **Sandboxes** (lab pool): 511568812872, 244686897857, 350823026476 (last is enterprise-reserved).
- Reach any member account by assuming `arn:aws:iam::<acct>:role/OrganizationAccountAccessRole` from the mgmt creds.

**Other providers:** Cloudflare (account `0ffe012ec833f7c0d329fbddeba2e4e9`, login info@shieldsyncsecurity.com — Workers + DNS); GitHub org `shieldsyncsecurity` (repos `labs-platform`, `shieldsync-website`); Azure sub `49ccf99f-6b70-429e-a192-90432cd2f014` (labs track, post-launch).

---

## 2. What is backed up, and how

### 2a. Code + content — Git (GitHub)
100% of code AND content is in Git: both apps, the engine, **blog posts** (`shieldsync-website/content/blog/*.json`), **lab templates + graders + guides** (`labs-platform/labs/*`, `engine/graders*.mjs`, `app/content/labs/*`), all settings JSON, deploy scripts, IAM policies. A total loss of AWS/Cloudflare is recoverable from Git alone (plus secrets from the password manager). **Optional hardening:** periodically `git bundle` both repos to the backup bucket for GitHub-account-loss insurance.

### 2b. Runtime data — DynamoDB, backed up TWO ways
1. **PITR (point-in-time recovery)** — ENABLED on all 17 `ShieldSync*` tables. Continuous, restore to any second in the last **35 days**, in-account/in-region. Best for "someone deleted/corrupted data today."
2. **Daily S3 export** — Lambda `ShieldSyncBackupExporter` (EventBridge `rate(1 day)`) exports every table to **`s3://shieldsync-backups-750294427884/exports/<YYYY-MM-DD>/<table>/`** in **us-west-2** (a DIFFERENT region from the us-east-1 data). Versioned + SSE + public-access-blocked. Lifecycle: Deep Archive after 90 days, expire after 730 days. Plain `DYNAMODB_JSON` — downloadable, greppable, re-importable anywhere. Best for "region outage," ">35-day retention" (legal: agreements are permanent, results 24 months), and off-account copies.

Trigger a backup on demand: `aws lambda invoke --function-name ShieldSyncBackupExporter --region us-east-1 /tmp/out.json && cat /tmp/out.json` (returns `{started, failed}`).

**True off-site (recommended monthly):** pull the latest export to storage outside AWS —
`aws s3 sync s3://shieldsync-backups-750294427884/exports/<date>/ ./shieldsync-backup-<date>/ --region us-west-2`.

### 2c. Secrets + config
Live ONLY in the owner's password manager (never in Git). Full inventory in §4. On a rebuild, every secret is re-set from there (or regenerated per §4).

---

## 3. Restore procedures

### 3a. Recover data damaged in the last 35 days (PITR)
```
# restore a fresh copy to a point in time, then repoint the app
aws dynamodb restore-table-to-point-in-time \
  --source-table-name ShieldSyncEntOrgs \
  --target-table-name ShieldSyncEntOrgs-restore \
  --restore-date-time <ISO8601 just before the damage> \
  --region us-east-1
# verify the -restore table, then swap: delete the bad table + rename via
# create-from-export, OR point the engine at the -restore name temporarily.
```
DynamoDB cannot overwrite a live table in place — you restore to a new name and cut over.

### 3b. Restore from an S3 export (>35 days, region loss, or into a fresh account)
```
# import a table from a dated export prefix into a NEW table
aws dynamodb import-table --region us-east-1 \
  --s3-bucket-source S3Bucket=shieldsync-backups-750294427884,S3KeyPrefix=exports/<date>/ShieldSyncEntOrgs \
  --input-format DYNAMODB_JSON \
  --table-creation-parameters '{"TableName":"ShieldSyncEntOrgs","AttributeDefinitions":[{"AttributeName":"orgId","AttributeType":"S"}],"KeySchema":[{"AttributeName":"orgId","KeyType":"HASH"}],"BillingMode":"PAY_PER_REQUEST"}'
```
Get each table's key schema + GSIs from its `create-*-table.mjs` / `create-ent-tables.mjs` script. Or just download the JSON and inspect: `aws s3 sync s3://.../exports/<date>/<table>/ ./ --region us-west-2`.

### 3c. Rebuild a whole app from Git
- **Marketing:** create an Amplify app from the `shieldsync-website` repo (`main`, static export, platform=WEB), re-add the custom rules (`amplify-custom-rules.json`) + `customHttp.yml`. DNS: point the domain at Amplify in Cloudflare.
- **Labs / Enterprise Workers:** `cd app` (or `enterprise`) then `npm ci && npm run cf:deploy` (needs `wrangler` authed to the info@ Cloudflare account), or push to `master` and let CI deploy. Re-set Worker secrets (§4).
- **Engines:** `engine/deploy/deploy.ps1` (B2C) and `engine/deploy/deploy-ent.ps1` (ent) — needs `ENGINE_SHARED_SECRET` / `ENT_ENGINE_SECRET` in the shell. They create the Lambda + role + API GW.
- **Tables:** run each `engine/create-*-table.mjs` + `create-ent-tables.mjs` + `create-ent-agreements-table.mjs` + `create-ent-audit-table.mjs` (idempotent, enable PITR). Then load data per §3b.
- **Sandboxes / pool:** `engine/provision.mjs` vends + bootstraps a sandbox account (roles, budget, pool registration).
- **Backups:** `infra/backup/setup-backup.sh` re-creates the bucket + exporter + schedule.

### 3d. Total-loss rebuild order (worst case)
1. Restore AWS account access (or a fresh account) + Cloudflare + GitHub.
2. Clone both repos from GitHub.
3. Re-set all secrets from the password manager (§4); regenerate any that can't be re-read.
4. Create tables (§3c) -> import data from the newest S3 export or the off-site copy (§3b).
5. Deploy engines -> apps -> marketing (§3c).
6. Re-run `setup-backup.sh`; verify a manual export.
7. Smoke-test: sign-in, a free lab launch, an enterprise assessment loop (`engine/ent-fullloop-test.mjs`).

---

## 4. Secrets & config inventory (WHERE they live + how to regenerate)

> Values are NOT in this file. This is the map. All values are in the owner's password manager.

| Secret / config | Used by | Where set | Regenerate |
|---|---|---|---|
| `ENGINE_SHARED_SECRET` | B2C engine <-> labs app | Lambda `ShieldSyncEngine` env + labs Worker secret | pick a new random value, set on both |
| `ENT_ENGINE_SECRET` | ent engine <-> ent app | Lambda `ShieldSyncEnterpriseEngine` env + ent Worker secret | new random, set on both (must match) |
| `SESSION_SECRET` | labs + ent apps (cookie signing) | Worker secret (each app) | new random; invalidates live sessions |
| `COGNITO_CLIENT_SECRET` | labs + ent Cognito SSO | Worker secret | Cognito console: app client (cannot rotate in place — new client + repoint) |
| `ADMIN_PANEL_SECRET` | ent staff login (legacy path) | ent Worker secret | new random |
| `GITHUB_TOKEN` | labs `/admin/labs` git-backed panel | labs Worker secret | GitHub fine-grained PAT (Contents RW on both repos) |
| `ENT_OTP_FROM` | ent OTP + invite emails | ent Lambda env | = `no-reply@shieldsyncsecurity.com` (SES verified identity) |
| `SHIELDSYNC_GSTIN` / `_ADDRESS` / `_STATE` | GST invoice (Wave 3B) | ent Worker vars | set from the real company registration |
| `CLOUDFLARE_API_TOKEN` / `_ACCOUNT_ID` | CI deploys | GitHub repo secrets | CF dashboard token scoped to the **info@** account (id 0ffe…2e4e9) |
| `PAYTM_MERCHANT_KEY` / mock pay | payments (not live) | labs Worker secret | Paytm dashboard on approval |
| Azure SP secrets (`shieldsync-lab-mgmt`, `-probe`) | Azure labs (post-launch) | password manager -> engine env at deploy | `infra/azure/setup-landing-zone.ps1 -RotateSecrets` |
| Cognito pools | auth | `us-east-1_5Hu20LAi8` (labs), `us-east-1_54vIGJe4R` (enterprise) | recreate pool = disruptive (repoint app + Google IdP) |

Cross-account access: base creds `apiuserforclaude` (acct 851) assume `OrganizationAccountAccessRole` into 750 + sandboxes.

---

## 5. Quick scenarios

- **"A bad deploy broke prod."** Code is in Git — `git revert` the commit + push; CI redeploys. No data restore needed.
- **"Someone deleted/corrupted data today."** §3a PITR restore to just before it.
- **"A whole table is gone / >35 days old."** §3b import from the latest S3 export.
- **"us-east-1 is down."** Data is safe in us-west-2 (§2b); import there (§3b) + repoint, or wait out the outage (PITR + exports intact).
- **"Lost the AWS account."** §3d full rebuild from Git + newest off-site export + password-manager secrets.
- **"Is a backup actually running?"** Check `s3://shieldsync-backups-750294427884/exports/` for today's date, or invoke the exporter manually (§2b). CloudWatch logs: `/aws/lambda/ShieldSyncBackupExporter`.

---

## 6. Backup system maintenance
- **Cadence / retention:** daily export; 730-day expiry; Deep Archive after 90 days. Tune in `setup-backup.sh` (lifecycle) — cheap while data is small; revisit if table sizes grow.
- **Add a new table:** the exporter auto-discovers any `ShieldSync*` table — no change needed. Enable PITR on it at creation (the `create-*-table.mjs` scripts do this).
- **Monthly:** pull an off-site copy (§2b) and spot-check a restore (§3b into a throwaway table) so recovery is proven, not assumed.
- **Cross-account hardening (optional):** replicate the backup bucket to a different AWS payer (or download off-cloud) so an org-level loss can't take both the data and its backups.
