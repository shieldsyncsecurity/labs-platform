# ShieldSync HR — employee document portal

Internal, low-headcount HR portal: issue **offer letters**, **payslips**, and collect **KYC**,
each on the company letterhead with a pre-signed seal. Next.js on **Cloudflare Workers**
(via OpenNext). Isolated data plane — its own HR engine + tables, separate from labs/enterprise.

- **Domain:** `employee.shieldsyncsecurity.com` (Worker `shieldsync-hr`).
- **Backend:** the **HR engine** (AWS Lambda), reached at `HR_ENGINE_URL`. Code lives in
  `../engine` (`hr-handler.mjs`).
- **Auth:** the enterprise Cognito **pool** but a **dedicated** app client (separate secret +
  callback list). Access is allowlist + admin-gated: `HR_ALLOWLIST` may sign in but starts with
  nothing until granted at `/access`; `HR_ADMIN_EMAILS` is the owner and can't be demoted from
  inside the portal. Changing either list requires a deploy, on purpose.
- **PDFs:** Cloudflare Browser Rendering (`BROWSER` binding) renders issued docs server-side.
  `/sealed/*` is forced through the Worker (`run_worker_first`) so the seal/signature never
  leaks as a public asset; `/brand` (logo) stays public.
- **⚠️ Routing:** `billing.shieldsyncsecurity.com` is owned by the separate `billing/` Worker —
  it must **never** appear in this app's `wrangler.jsonc` `routes`, or an HR deploy steals the
  billing domain.

## Key dirs

| Path | What |
|---|---|
| `app/` | App-router routes (staff dashboard, issue/withdraw docs, KYC, `/access`, `/sealed/*`) |
| `components/` | Shared React components |
| `lib/` | Session/auth, engine client, PDF + letterhead helpers |
| `middleware.ts` | Session gate for portal routes |
| `tests/` | `node tests/run.mjs` — payslip / access / time suite (gates the deploy) |
| `docs/`, `GO-LIVE.md` | HR-specific build/go-live notes |

## Dev

```bash
npm install
npm run dev        # next dev on http://localhost:3003
npm test           # tests/run.mjs
```

## Deploy

Production build **must** use webpack (`next build --webpack`); Turbopack breaks OpenNext.

- **Automatic:** a push to `master` touching `hr/**` runs `.github/workflows/deploy-hr.yml`.
  **`npm test` runs first and a failure blocks the deploy.**
- **Manual:** `npm run cf:deploy` from this folder.

Worker secrets — `HR_ENGINE_SECRET`, `HR_SESSION_SECRET`, `COGNITO_CLIENT_SECRET`,
`MS_CLIENT_SECRET` — are set with `wrangler secret put` and preserved by `wrangler deploy`;
`wrangler.jsonc` holds **non-secret** `vars` only.
