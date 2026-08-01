# ShieldSync Billing — client invoice viewer

The public-facing invoice app: a client opens a signed invoice link and views/downloads it at
`/inv`. Next.js on **Cloudflare Workers** (via OpenNext). Deliberately small — it owns the
billing domain and nothing else.

- **Domain:** `billing.shieldsyncsecurity.com` (Worker `shieldsync-billing`). This is the
  **only** Worker that may claim this domain — the HR Worker must never list it in `routes`.
- **Backend:** reads invoices from the **HR engine** (AWS Lambda) at `HR_ENGINE_URL`. Invoice
  links are tokens **signed by the HR portal**; billing only **verifies** them with
  `HR_SESSION_SECRET` — it never signs new tokens and never issues invoices.

## Key dirs

| Path | What |
|---|---|
| `app/` | `/inv` (invoice view), `page.tsx`, `not-found.tsx`, `layout.tsx` |
| `components/` | Shared React components |
| `lib/` | Token verification + HR-engine client |
| `wrangler.jsonc` | Worker config, custom-domain route, **non-secret** `vars` |

## Dev

```bash
npm install
npm run dev        # next dev on http://localhost:3004
```

## Deploy

Production build **must** use webpack (`next build --webpack`); Turbopack breaks OpenNext.

- **Automatic:** a push to `master` touching `billing/**` runs
  `.github/workflows/deploy-billing.yml` (`npm run cf:deploy`). No test suite yet — the webpack
  build still type-checks and fails the deploy on a type error.
- **Manual:** `npm run cf:deploy` from this folder.

Worker secrets — `HR_ENGINE_SECRET`, `HR_SESSION_SECRET` — are set with `wrangler secret put`
and preserved by `wrangler deploy`; `wrangler.jsonc` holds **non-secret** `vars` only.
