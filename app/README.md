# ShieldSync Labs — storefront app

The B2C labs product: catalogue, sign-in, checkout, and the launch/teardown UI a learner
uses to spin up a real AWS sandbox. Next.js on **Cloudflare Workers** (via OpenNext).

- **Domain:** `labs.shieldsyncsecurity.com` (Worker `labs-platform`).
- **🟢 PAYMENTS-LIVE** — Paytm PG is in production (`PAYMENTS_LIVE=1`). Treat checkout,
  entitlements, and anything under `app/api/**` as money-live: change with care.
- **Backend:** the labs **Session Engine** (AWS Lambda), reached at `ENGINE_URL`. Code lives
  in `../engine` (`handler.mjs`); this app never talks to AWS directly.
- **Auth:** Cognito (+ Google) — see `wrangler.jsonc` `vars` and `AUTH_AND_DEPLOY_RUNBOOK.md`.

## Key dirs

| Path | What |
|---|---|
| `app/` | App-router routes: `labs/`, `dashboard/`, `account/`, `admin/`, `sign-in/`, `verify/`, `api/`, `privacy/`, `terms/` |
| `components/` | Shared React components |
| `content/` | Marketing/lab copy rendered by the app |
| `lib/` | Client + server helpers (auth, payments, engine client) |
| `public/` | Static assets |
| `lab-settings.json` | Per-lab display/pricing overrides (kept in sync by `../scripts/sync-lab-settings.mjs`) |
| `wrangler.jsonc` | Worker config + **non-secret** `vars` (secrets go via `wrangler secret put`) |

## Dev

```bash
npm install
npm run dev        # next dev on http://localhost:3001
```

## Deploy

Production build **must** use webpack (`next build --webpack`); Turbopack breaks OpenNext.

- **Automatic:** a push to `master` touching `app/**` runs `.github/workflows/deploy-labs.yml`
  (`npm run cf:deploy` = OpenNext build + `wrangler deploy`).
- **Manual:** `npm run cf:deploy` from this folder.

`wrangler deploy` preserves existing Worker secrets and `vars` — CI never sets them.
The `PAYTM_MERCHANT_KEY` and Cognito/session secrets are Worker secrets, never in source.
