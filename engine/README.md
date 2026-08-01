# ShieldSync Engine — AWS Lambda backends

The server-side control plane for the whole platform. **Not** a Cloudflare Worker — these are
**AWS Lambda** functions in the platform account (`750294427884`, `us-east-1`, `nodejs22.x`),
each fronted by an API Gateway HTTP API that the Worker apps call over `*_ENGINE_URL`. They vend
throwaway AWS/Azure accounts, deploy labs, grade work, tear everything down, and (for HR)
render/store sealed documents.

> **Not in CI.** The four `.github/workflows/deploy-*.yml` only deploy the Cloudflare Worker
> apps. The engine ships **only** via the PowerShell scripts below — run from `engine/`.

## Handler index (entrypoints)

| Handler | Lambda | Serves | Imports |
|---|---|---|---|
| `handler.mjs` | `ShieldSyncEngine` | labs (`labs.shieldsyncsecurity.com`) | `labinfra.mjs`, `graders.mjs`, `metrics.mjs` |
| `hr-handler.mjs` | `ShieldSyncHrEngine` | HR (`employee.shieldsyncsecurity.com`) | single-file bundle |
| `ent-handler.mjs` | `ShieldSyncEnterpriseEngine` | enterprise (`enterprise.shieldsyncsecurity.com`) | `entinfra.mjs` + reused `labinfra`/`graders`/`metrics` + `azure-infra`, `graders.azure`, `recinfra`, `timeline`, `taxonomy` |

**Support modules:** `labinfra.mjs` (AWS sandbox vend/isolate/nuke), `entinfra.mjs` (assessment
infra), `azure-infra.mjs` (Azure labs), `graders.mjs` / `graders.azure.mjs` (auto-graders),
`recinfra.mjs` (session recordings), `timeline.mjs` / `taxonomy.mjs` (enterprise scoring),
`metrics.mjs`. `server.mjs` is a local dev harness (`npm start`).

**One-off infra scripts** (`create-*.mjs`, run once with AWS creds): DynamoDB tables/GSIs for
labs (`create-users/queue/orders/completions-*`), enterprise (`create-ent-*`), and HR
(`create-hr-tables`, `create-hr-kyc-infra`). Plus test/verify/load helpers (`ent-e2e.mjs`,
`ent-*-test.mjs`, `load-test-*.mjs`, `try-*.mjs`, `verify-*.mjs`, `pool-status.mjs`,
`reset-pool.mjs`).

## Deploy targets (`engine/deploy/`)

Each script assumes into the platform account, (re)creates the IAM role from `policy*.json` /
`trust.json`, zips the handler + its modules, and creates/updates the Lambda + HTTP API.

| Script | Deploys | Notes |
|---|---|---|
| `deploy/deploy.ps1` | **labs** — `ShieldSyncEngine` | also bundles `../labs/**` into the zip |
| `deploy/deploy-hr.ps1` | **hr** — `ShieldSyncHrEngine` | single-file (`hr-handler.mjs`) |
| `deploy/deploy-ent.ps1` | **ent** — `ShieldSyncEnterpriseEngine` | import-closure guard refuses to ship a missing module |

```powershell
# from engine/
.\deploy\deploy.ps1        # labs
.\deploy\deploy-hr.ps1     # hr
.\deploy\deploy-ent.ps1    # enterprise
```

Each prints the resulting `*_ENGINE_URL` — set it on the matching Worker's `wrangler.jsonc`
`vars`. The shared `*_ENGINE_SECRET` (matched to each Worker's `x-engine-token`) is a Lambda
env var / Worker secret, never committed here.
