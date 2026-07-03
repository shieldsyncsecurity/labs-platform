# ShieldSync Labs — Auth & Deploy Runbook

> Last updated: 2026-06-25. Living doc. No secret **values** live here on purpose —
> only their names and where they're stored. Actual values: `app/.env.local`
> (gitignored, local) and Cloudflare Worker secrets (prod).
>
> **What changed since the big 2026-06-11 build:** security hardening went in (engine
> shared-secret / `X-Engine-Token`, session-ownership, path-traversal); the lab
> catalogue was **cut to 2 labs** (`s3` + `iam`) — the other 4 (kms/vpc/cloudtrail/
> guardduty) were **deleted**; **CI/CD** now auto-deploys both repos on push; the launch
> path got an **atomic per-user lock (H3)**; a **wait-room queue** + **server-authoritative
> live-lab restore** landed; an **admin ratings readout** shipped; the engine IAM was
> **narrowed**; `SESSION_SECRET` was **rotated**; the grader **false-pass** was fixed.
> Two deploy gotchas were learned (CI-token account, ISP-DNS on Function URLs).
>
> **2026-07-03 — Razorpay removed; Paytm is THE provider (owner decision):** the dormant
> Razorpay-shaped `/api/payments/webhook` route and `lib/payments/provider.ts`
> (`RAZORPAY_WEBHOOK_SECRET`) were **deleted**. The production trust path is now solely the
> Paytm pair `/api/payments/paytm/confirm` + `/paytm/callback` — both re-confirm
> server-to-server via Paytm's Order Status API against the server-persisted order and grant
> idempotently via `POST /orders/paid`. Any Razorpay mention below this line is historical.
>
> **2026-06-25 — payment trust-path hardening (pre-go-live):** the payment-confirmation
> path was re-architected so it can't be replayed into a self-grant. `/api/payments/checkout`
> is auth-only (session sub, never `body.userId`); the real-provider `/api/payments/webhook`
> now verifies the **provider** secret (`RAZORPAY_WEBHOOK_SECRET`), NOT the internal mock
> secret, and grants only against a **server-persisted order** (amount/currency match +
> idempotent `created->paid`). The old internally-signed, client-replayable fulfill path is
> now dev-simulator-only. Verified by curl replay (a checkout/mock-signed payload -> 400,
> never a grant). Still gated OFF in prod (`PAYMENTS_LIVE` unset) and needs the engine
> `/orders` endpoints before go-live. See **section 6d**.

This is the operational reference for the **ShieldSync Labs platform**
(`labs.shieldsyncsecurity.com`) — the hands-on AWS security labs product. It covers
the architecture, the deploy process, the Cognito+Google auth wiring, the gotchas that
bit us during launch hardening, and the known pending work.

---

## 0. LIVE STATUS — read this first (2026-06-24)

**Everything in this table is DEPLOYED and verified. If a tracker/doc says any of
these is "not done / need to verify / wrangler not run / half-wired," that tracker is
STALE — THIS file is the source of truth.**

| Component | Status | Detail |
|---|---|---|
| App — Cloudflare Worker `labs-platform` | LIVE | auto-deployed by CI on push to `master` (app/**); pages + auth + lab UI all 200 |
| CI/CD — both repos | LIVE | labs app: GitHub Actions `.github/workflows/deploy-labs.yml` (`npm run cf:deploy`) on push to `master` touching `app/**`. Marketing: Cloudflare Workers Builds on push to `main`. Engine still deploys manually (deploy.ps1). |
| Cognito + Google sign-in | LIVE | Google OAuth app In Production; account-chooser forced (`prompt=select_account`); `returnTo` honored; demo/mock login DISABLED in prod (real accounts only) |
| App -> Engine wiring + shared-secret guard | LIVE | `ENGINE_URL` (API GW) + `ENGINE_SHARED_SECRET` set; engine refuses any non-`/health` request without a matching `x-engine-token`; app attaches it via `lib/server/engine.ts`. Ownership via `x-user-id`. |
| Engine Lambda `ShieldSyncEngine` (acct 750) | DEPLOYED | `/health` 200; IAM narrowed (dynamodb:* -> 6 verbs); routes incl. `/launch /active /queue /grade /rate /ratings/summary /console /session/*` |
| Reaper + Warmer crons | LIVE | EventBridge `ShieldSyncReaper rate(3 min)` + `ShieldSyncWarmer rate(10 min)`; verified |
| H3 atomic launch lock | LIVE | per-user lock (table `ShieldSyncLabUserLocks`, TTL) acquired before leasing -> no double-lease; concurrent same-user -> reconnect or 409 ALREADY_ACTIVE. Concurrency-tested (5 simultaneous -> 1 lease + 4 reconnects) |
| Wait-room queue + live-lab restore | LIVE | full free pool -> 503 FREE_AT_CAPACITY w/ `nextFreeAt` + place-in-line (`ShieldSyncLabQueue` table, TTL); `/queue` poll auto-grabs a freed seat; `/active` restores a running lab on any tab/device. Load-tested 15/15 + live e2e |
| Admin ratings readout | LIVE | server-gated `/admin/ratings` (admins = `ADMIN_USER_IDS` Cognito subs) -> engine `/ratings/summary` aggregates `ShieldSyncLabRatings` per lab |
| Lab account pool | CLEAN | 3 sandboxes `available`. `FREE_POOL_PCT = 1.0` (INTERIM — free can use the whole pool until paid launches; revert to ~0.3 then) -> 3 concurrent free |
| Lab launch / teardown | VERIFIED | warm hit -> instant; cold ~72s; teardown = aws-nuke -> `available`. Teardown-during-cold-deploy race fixed (conditional `status=leasing` write) |
| Access rules (session length + launch caps) | LIVE | per-tier; free = 1 launch / **24h** (was 48h — loosened 2026-06-25 for a better first try), surfaced in the UI (idle chip + limit msg + marketing lab page). See section 6b |
| Auto-grader ("Check my work") | LIVE | scores a live lab vs `successCriteria`; false-pass fixed (only expected-absence errors count clean; transient AWS errors -> `unknown`, never pass) |
| Pool scaling past 5 accounts | BLOCKED | AWS org account cap = 5 (at limit); needs a Support quota increase (your action). See section 9 |
| `SESSION_SECRET` rotation | DONE | rotated 2026-06-22 (wrangler secret put; sessions invalidated) |
| `COGNITO_CLIENT_SECRET` rotation | PENDING | no in-place rotation -> needs a NEW app client + re-test (your action; not web-exposed -> lower urgency). See section 9 |
| Payment trust path (bypass fix) | HARDENED 2026-06-25 | checkout is auth-only; webhook verifies the **provider** secret (not the mock one) against a server-persisted order w/ amount + idempotency checks; old replayable fulfill path is dev-sim-only. Still gated OFF (`PAYMENTS_LIVE` unset). See 6d |
| Real Paytm | WIRED, awaiting merchant approval (days) | Paytm JS Checkout + server-to-server confirm/callback + engine `/orders` all built; Razorpay code deleted 2026-07-03. Go-live = flip `PAYTM_ENV`→production + `PAYMENTS_LIVE=1` + e2e verify |

**Lab catalogue = exactly 2 labs, both live + graded: `s3-misconfiguration-audit`
(free, Beginner) + `iam-privilege-escalation` (paid, Intermediate).** The 4 not-ready
labs (kms, vpc, cloudtrail, guardduty) were **DELETED 2026-06-22** (catalogue + content
+ templates). Do NOT treat them as "todo" — new lab content is the owner's to design.

> **Cross-session note:** this file + the auto-memory (`project_shieldsync_labs.md`)
> are the source of truth. A *running* Claude session loaded its memory at its own
> start, so it won't see later updates until it re-reads this file. Multiple sessions
> share the tree, so commit **path-scoped**, never blanket `git add -A`.

---

## 1. What this is

A Next.js app that sells/serves browser-based AWS security labs. A user signs in
(Google via Cognito), pays (Paytm; gated off until merchant approval), and launches a lab
that leases a throwaway AWS account brokered by a backend "engine" Lambda.

- **Frontend/app:** Next.js 16 on **Cloudflare Workers** (via the OpenNext adapter).
- **Engine:** AWS Lambda behind API Gateway; owns AWS creds, leases lab accounts,
  writes entitlements/sessions/users/ratings to DynamoDB.
- **Auth:** Amazon Cognito Hosted UI federating Google (LinkedIn configured but Google
  is the live path). Mock/offline login exists for local dev only — disabled in prod.

---

## 2. Architecture & the AWS org (5 accounts, full cross-account access)

The CLI creds (`apiuserforclaude`) are the **org MANAGEMENT account** (`851`), so you
can reach **every** member account by assuming a role — there is no access wall:

| Concern | AWS account | Notes |
|---|---|---|
| **Mgmt + Cognito** — CLI creds `apiuserforclaude`, Cognito user pool | **851236938541** ("ShieldSync Labs") | `aws sts get-caller-identity` returns this; org master of `o-v0q5eumtob`. |
| **Engine** Lambda + DynamoDB infra tables + deploy bucket | **750294427884** ("ShieldSync Platform") | Lambda ARN, table ARNs, `shieldsync-engine-deploy-750294427884`. |
| **Lab pool sandboxes** (leased, auto-nuked) | `511568812872`, `244686897857`, `350823026476` | The throwaway accounts learners get. |

**Cross-account access (important):** to touch the engine Lambda, the Platform
DynamoDB tables, EventBridge, or a sandbox, **assume the org role first**:

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::750294427884:role/OrganizationAccountAccessRole \
  --role-session-name work
# export the returned creds, then run aws/lambda/dynamodb/events commands in 750
```

> Gotcha that cost time: `aws dynamodb list-tables` / `aws lambda get-function` with
> the *default* (851) creds returns empty / "not found" — that does NOT mean no access;
> it means you queried the wrong account. **Assume `OrganizationAccountAccessRole` into
> 750 first.** (`engine/deploy/deploy.ps1` and `labinfra.mjs` do exactly this.)

```
Browser -- Cloudflare Worker (labs-platform) --HTTP--> Engine API Gateway --> Lambda --> DynamoDB
   |              (Next.js app)                          (acct 750294427884)
   |   (every engine call carries x-engine-token; ownership via x-user-id)
   +-- Cognito Hosted UI (acct 851236938541) -- Google OAuth (GCP project 301695920084)
```

---

## 3. Tech stack & the CRITICAL build rule

- Next.js **16.2.7**, React 19.2
- `@opennextjs/cloudflare` **1.19.11**, `wrangler` 4.x
- Tailwind v4

### Production builds MUST use webpack, not Turbopack

Next 16 defaults `next build` to **Turbopack**. Turbopack emits SSR chunks named
`server/chunks/ssr/[root-of-the-server]__*._.js` that **`@opennextjs/cloudflare`
cannot load at runtime** -> the deployed Worker throws `ChunkLoadError` and every page
500s.

**The fix is already wired in** and must not be reverted:
- `app/package.json` -> `"build": "next build --webpack"`
- `app/next.config.ts` keeps `turbopack: { root: process.cwd() }` for **dev only**.

Verify a build is clean: there should be **no** `[root-of-the-server]` files under
`app/.next/server/`. (The marketing site has the identical rule — see its AGENTS.md.)

---

## 4. Deploy process

### App (Cloudflare Worker `labs-platform`)

**CI/CD (normal path):** push to `master`. GitHub Actions
`.github/workflows/deploy-labs.yml` runs `npm run cf:deploy` whenever the push touches
`app/**`. Requires two repo secrets: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
(`0ffe012ec833f7c0d329fbddeba2e4e9`).

> **CI-token GOTCHA (cost a failed run):** the API token MUST be scoped to the
> **`Info@shieldsyncsecurity.com`** Cloudflare account (id `0ffe...2e4e9` — where the
> Workers live; `wrangler whoami` confirms). A token made under a *different* login
> (`Shieldcybersecurity@gmail.com`'s account) is valid and has Workers Scripts:Edit but
> fails with **`Authentication error [code: 10000]`** because it can't see the `0ffe...`
> account. Two CF logins exist; the Workers are under **info@**, not the gmail one.

**Manual deploy (fallback)** from `app/`:

```powershell
npm run cf:deploy          # = opennextjs-cloudflare build (webpack) + wrangler deploy
```

- Worker name = **`labs-platform`** in `app/wrangler.jsonc`. Don't rename it.
- Deploys do **not** wipe secrets (see section 6).
- Non-secret config lives in the `vars` block of `wrangler.jsonc`.
- Live URLs: `https://labs.shieldsyncsecurity.com` and
  `https://labs-platform.sparkling-dew-f01e.workers.dev`.

### Engine (Lambda `ShieldSyncEngine`, acct 750) — still manual

```powershell
& engine/deploy/deploy.ps1   # assume into 750 -> zip handler+labinfra+graders+labs/ -> S3 -> Lambda -> ensure API GW + put-role-policy
```

- `deploy.ps1` also applies `engine/deploy/policy.json` (the narrowed IAM) via
  `put-role-policy` every run.
- **ALWAYS verify** `engine/deploy/engine.zip` entries read `labs/<slug>/template.yaml`
  after a deploy (a past rel-path bug shipped them mangled — see incident #8).
- A new grader file or lab dir must be in the `Compress-Archive` line or it won't ship.

> **ISP-DNS GOTCHA (cost 2 failed runs):** the engine Lambda **Function URL**
> (`*.lambda-url.us-east-1.on.aws`) is **not resolvable** from some ISPs (e.g. the
> owner's Reliance DNS returns `Query refused`). Always hit the engine via the **API
> Gateway** base `https://lewssnjjhi.execute-api.us-east-1.amazonaws.com` (resolves
> fine; it's what the app uses). Also: the Bash-tool sandbox blocks outbound to AWS
> Function-URL hosts — run engine-hitting scripts with `dangerouslyDisableSandbox`.

---

## 5. Cognito + Google auth

### Cognito (account 851236938541, region us-east-1)
- **User pool:** `us-east-1_5Hu20LAi8` ("ShieldSync Pool")
- **App client:** `36s7i98jnt0mj8n5m8h0s711kn` ("ShieldSync-Web"); has a client secret;
  Allowed OAuth flow = `code`; scopes = `openid email profile`.
- **Hosted UI domain:** `shieldsync-labs.auth.us-east-1.amazoncognito.com`
- **App client Callback URLs** (the App<->Cognito leg):
  - `https://labs.shieldsyncsecurity.com/api/auth/callback`
  - `https://labs-platform.sparkling-dew-f01e.workers.dev/api/auth/callback`
  - `http://localhost:3001/api/auth/callback`

### Google OAuth (GCP project 301695920084)
- **OAuth client id:** `301695920084-3f1l4jjjoetn70g6pstq87jrmini24vb.apps.googleusercontent.com`
- **Authorized redirect URI** (the Cognito<->Google leg — NOT the app URL):
  `https://shieldsync-labs.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- **Publishing status:** **In production** (any Google account can sign in).

### The OAuth flow (and where each leg can break)
1. App `/api/auth/login` -> 302 to Cognito `/oauth2/authorize?identity_provider=Google`
   (sets a short-lived CSRF state cookie; adds `prompt=select_account` so Google always
   shows the account chooser; carries a sanitized `returnTo`).
2. Cognito -> 302 to Google consent.
3. User picks account / consents.
4. Google -> 302 to Cognito `/oauth2/idpresponse`.
5. Cognito provisions/updates the pool user, mints its own code.
6. Cognito -> 302 to app `/api/auth/callback?code=...&state=...`.
7. App callback: exchanges code, verifies the id_token (jose/JWKS), sets the session
   cookie, persists the user via `after()` (see incident #6), redirects to `returnTo`
   or `/dashboard`.

Code: `app/lib/auth/cognito.ts` (server, incl. `authorizeUrl()` / `makeSession` /
`readSession`), `app/app/api/auth/*` (routes), `app/lib/auth/context.tsx` +
`cognito-adapter.ts` (client). Client mode is gated on
`NEXT_PUBLIC_AUTH_MODE === "cognito"`. **Mock login** (`ALLOW_MOCK` in `context.tsx`) is
gated to `!COGNITO_ENABLED && NODE_ENV !== "production"` -> prod has no non-Cognito path.

---

## 6. Environment variables & secrets

**Non-secret** -> `app/wrangler.jsonc` `vars` (prod) and `app/.env.local` (local):
`ENGINE_URL`, `NEXT_PUBLIC_AUTH_MODE=cognito`, `COGNITO_REGION`, `COGNITO_DOMAIN`,
`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `APP_URL`, **`ADMIN_USER_IDS`**.

- `APP_URL` = `https://labs.shieldsyncsecurity.com` in prod; `http://localhost:3001` local.
- **`ADMIN_USER_IDS`** = comma-separated Cognito **subs** (opaque UUIDs, not PII) allowed
  to see `/admin/ratings`. Currently the owner's labs sub
  `b4b864a8-80b1-705f-2c40-fee7397141d2` (he has a 2nd sub
  `e4684478-c001-7084-1fed-107163fe9132` from another Google acct — add it to grant both).

**Secrets** -> Cloudflare Worker secrets (prod) + `app/.env.local` (local):
`COGNITO_CLIENT_SECRET`, `SESSION_SECRET`, **`ENGINE_SHARED_SECRET`** (the
`x-engine-token` the app sends; the engine mirrors it as an env var on the Lambda in
750). Set/rotate with:

```bash
# Pipe clean ASCII bytes — do NOT type the value interactively in PowerShell;
# smart-quotes/encoding can inject a non-Latin1 char (see incident #4).
printf '%s' '<value>' | npx wrangler secret put SESSION_SECRET    # via Bash tool
```

`ENGINE_URL` is the engine **API Gateway**:
`https://lewssnjjhi.execute-api.us-east-1.amazonaws.com` (NOT a Lambda Function URL —
see the ISP-DNS gotcha in section 4).

**Payments (ALL UNSET in prod until go-live — the flow is dormant):** documented in
`app/.env.example`. See section 6d for the trust model.
- `PAYMENTS_LIVE` (non-secret) — master switch. Unset -> `/checkout` 503 + Paytm
  `/paytm/confirm` + `/paytm/callback` 404.
- `PAYTM_*` (`PAYTM_ENV`/`PAYTM_MID`/`PAYTM_WEBSITE` in wrangler.jsonc + the merchant-key
  Worker secret) — the live provider config. (`RAZORPAY_WEBHOOK_SECRET` removed 2026-07-03
  along with the webhook route; if a Worker secret by that name still exists in the
  Cloudflare dashboard, delete it.)
- `MOCK_PAYMENT_SECRET` (**secret**) — signs dev-simulator order tokens ONLY (mock-pay).
  NOT a provider secret; deliberately never shared with the webhook trust path.
- `ALLOW_MOCK_PAY` (non-secret) — dev/preview only; enables the simulated gateway
  (`/api/payments/mock-pay`). MUST stay unset in prod (it's a "mark this paid" button).

**DynamoDB tables (acct 750294427884, all PAY_PER_REQUEST):**
`ShieldSyncLabAccounts`, `ShieldSyncLabSessions`, `ShieldSyncLabUsers`,
`ShieldSyncLabEntitlements`, `ShieldSyncLabRatings`,
`ShieldSyncLabUserLocks` (H3 per-user launch lock, TTL on `ttl`),
`ShieldSyncLabQueue` (wait-room place-in-line, TTL on `ttl`),
`ShieldSyncLabOrders` (payment orders, pk `orderId`, TTL on `ttl` ~90d — §6d).
**EventBridge crons (acct 750):** `ShieldSyncReaper` (`rate(3 min)`->reap),
`ShieldSyncWarmer` (`rate(10 min)`->warm).

---

## 6b. Access rules — session length & launch limits

**Single source of truth is duplicated across THREE files — keep in sync:**
- engine `engine/labinfra.mjs` `LEVEL_RULES` / `FREE_RULE` (authoritative; enforces),
- labs app `app/lib/access-rules.ts` (`rulesForLab`; shown in `LabPanel`),
- marketing `shieldsync-website/lib/site.ts` `LAUNCH_RULES` / `launchPolicyText()`
  (shown on marketing lab pages).

| Tier | Session length | Launches | Window |
|---|---|---|---|
| **Free lab** (`free:true`, `s3`) | 30 min | **1x** | 24 h |
| **Beginner** (paid) | 30 min | 3x | 72 h |
| **Intermediate** (`iam`) | 60 min | 2x | 48 h |
| **Advanced** | 120 min | 2x | 48 h |
| **Monthly** sub | per-lab length | unlimited | 30-day entitlement |

- **Launch limit** = rolling count of a user's runs for that lab (`launchCount()`),
  excluding failed deploys. Over the cap -> engine **429 `LIMIT_REACHED`**. Reconnecting
  to an *active* session doesn't count. **The cap is surfaced in the UI** so it's not a
  surprise: LabPanel idle chip ("Free lab - 1 launch every 24h") + the limit-reached
  message (rolling-window wording) + the marketing lab hero chip ("Free - 1 launch / 24h").
  (All UI copy is DATA-DRIVEN off the rule, so changing windowHours updates it everywhere.)
- **Free-pool cap** (`FREE_POOL_PCT` in labinfra): free labs may occupy at most this
  share of the pool at once; over it -> **503 `FREE_AT_CAPACITY`**. **Currently 1.0
  (INTERIM)** — paid isn't live, so free uses the whole pool (3 accts -> 3 concurrent
  free). **Revert to ~0.3 once paid launches** so a free rush can't starve payers.
- **Reset dev counter for testing:** `node engine/try-reset-rate.mjs <slug> <hours>`
  flips already-ended sessions to `status=error` so they stop counting (safe: never
  touches live sessions). Needed because the free cap (1/24h) trips fast during testing.

---

## 6c. Post-June-11 additions (security + reliability)

- **Engine shared-secret guard** (security audit): every engine request except
  `GET /health` must carry `x-engine-token` == `ENGINE_SHARED_SECRET` or it's 401. The
  app attaches it through `app/lib/server/engine.ts` (`engineFetch` / `engineFetchAsUser`)
  — NEVER import that module into client code (it would leak the secret). Ownership: the
  app sends `x-user-id` (verified Cognito sub); engine checks it on per-session actions.
- **H3 atomic launch lock:** `/launch` acquires a conditional-PutItem lock in
  `ShieldSyncLabUserLocks` (TTL = session + grace) **before** leasing -> closes the
  double-lease TOCTOU. Lost race / already-active -> reconnect to the same-lab session or
  **409 ALREADY_ACTIVE**. Released on teardown, deploy-failure, and every reject path.
- **Wait-room queue (informational):** when the free pool is full, `/launch` returns
  503 with `nextFreeAt` + enqueues the user in `ShieldSyncLabQueue`; `GET /queue` returns
  `{reached, nextFreeAt, position, waiting}`. LabPanel shows a countdown + "place in line",
  polls `/queue` every ~12s, and **auto-launches when a seat frees**. Allocation stays
  first-to-retry (no head-of-line handoff -> no pool-deadlock risk).
- **Server-authoritative live-lab restore:** `GET /active?labSlug=` ->
  `findActiveSession(uid, labSlug)`; the app route `/api/active-session` + a LabPanel
  mount effect restore a running lab on **any tab/device** (closes the per-tab
  sessionStorage gap).
- **Admin ratings:** `GET /ratings/summary` aggregates `ShieldSyncLabRatings` per lab;
  server-gated page `/admin/ratings` (gate = `isAdmin()` in `app/lib/auth/admin.ts`
  checking the session sub against `ADMIN_USER_IDS`).
- **Engine IAM narrowed:** `engine/deploy/policy.json` DynamoDB action `*` -> the 6 verbs
  the Lambda uses (GetItem/PutItem/UpdateItem/DeleteItem/Query/Scan) across all table
  ARNs incl. Locks + Queue. AssumeRole already scoped to `LabExec`/`LabUser` role names.
- **Grader false-pass fixed:** `graders.mjs` only treats expected-absence errors
  (NoSuchBucketPolicy etc.) as a clean pass; transient errors (throttle/AccessDenied) ->
  criterion `unknown`, which never counts as passing.
- **Dev helpers (engine/):** `try-reset-rate.mjs` (reset launch counter),
  `load-test-waitroom.mjs` (seed pool -> assert 503/queue, auto-cleanup),
  `demo-waitroom.mjs` (fill/free/clean for live wait-room demos),
  `create-queue-table.mjs` (one-shot table create + TTL).

---

## 6d. Payment trust model (bypass fix, 2026-06-25)

**Why:** a security review found a latent payment-bypass chain. It was already dormant
in prod (checkout auth + `PAYMENTS_LIVE` gating were in place), but the moment
`PAYMENTS_LIVE=1` were set for go-live it would have re-opened: the webhook fulfilled
from a **self-describing, client-replayable payload** that was signed with the SAME
`MOCK_PAYMENT_SECRET` used to sign checkout tokens — so anyone could replay a checkout
response into the webhook and self-grant all-access. Re-architected so that's impossible
by construction.

**The trust path now (do NOT weaken):**
1. **`/api/payments/checkout`** (`app/app/api/payments/checkout/route.ts`) — auth-only
   (`getServerUser()`; uses the session sub, never `body.userId`), gated by `PAYMENTS_LIVE`.
   Persists a **server-side order** (`status:"created"`) via `lib/server/orders.ts`. The
   signed payload it still returns is consumed ONLY by the dev simulator (mock-pay).
2. **Paytm confirm/callback** (`/api/payments/paytm/confirm` + `/paytm/callback`; the old
   Razorpay-shaped `/api/payments/webhook` + `lib/payments/provider.ts` were DELETED
   2026-07-03) — neither trusts the client/popup result: both re-confirm
   **server-to-server** via Paytm's Order Status API (`transactionStatus`), then validate
   against the persisted order and grant only on an **idempotent `created->paid`
   transition**, so a replayed delivery can't double-grant. Fails CLOSED at every step.
3. **`lib/payments/fulfill.ts`** (the old internally-signed verify+fulfill) is now
   **dev-simulator-only** — used solely by `mock-pay` (404 in prod). It must never back the
   real webhook again.

**Files (current):** `lib/payments/paytm.ts` (initiate + Order Status), `lib/server/orders.ts`
(order store), `paytm/confirm/route.ts` + `paytm/callback/route.ts`, `checkout/route.ts`
(persists order + initiates Paytm txn), `fulfill.ts` (scoped to dev), `.env.example`.

**✅ Engine order store — BUILT + DEPLOYED + VERIFIED (2026-06-25, commit `8dd205a`):**
the three token-guarded routes the order store calls now exist in `engine/handler.mjs`
(+ `createOrder`/`getOrder`/`markOrderPaid` in `labinfra.mjs`), backed by the new
**`ShieldSyncLabOrders`** table (pk `orderId`, 90-day TTL; IAM policy grants it):
- `POST /orders` — persist the order (status forced `"created"`; won't overwrite a PAID one)
- `GET /orders?orderId=` — return `{order}` (null if absent → webhook fails closed)
- `POST /orders/paid` — atomic conditional `created->paid` CAS → `{transitioned}` (true only
  for the call that flipped it, so out of N webhook retries exactly one grants)

Verified live 6/6: create→get(created)→paid(true)→replay(false)→paid keeps the 1st
paymentId→unknown order returns null. **Remaining before `PAYMENTS_LIVE=1` is now ONLY
config:** Paytm merchant approval → flip `PAYTM_ENV` to production + set the production
merchant-key secret, then run the e2e verification. The whole server-side trust path is
code-complete (Paytm adapter: `lib/payments/paytm.ts`).

**Verified (curl replay, dev, `PAYMENTS_LIVE=1`):**
- unauthenticated checkout `{plan:monthly,userId:attacker}` -> **401** (can't even mint a token)
- replay a mock-secret-signed checkout payload to the (since-deleted) webhook -> **400**
  (historical test of the old route; the route was removed 2026-07-03)
- Paytm path: confirm/callback never trust the posted result — they re-query Paytm's Order
  Status API server-to-server, so a forged "success" post can't grant

---

## 6e. Launch-hardening, observability & UX (2026-06-25 session)

Everything below is **deployed + verified**. Grouped by area.

### Observability (engine → CloudWatch)
- **EMF metrics** (`engine/metrics.mjs`, `metric()`): logs Embedded-Metric-Format JSON to
  stdout → CloudWatch auto-extracts under namespace **`ShieldSyncLabs`** (no PutMetricData,
  no extra IAM, ~free). Emitted across handler/labinfra: `Deploy{success,failed}` +
  `ColdDeploySeconds`, `Teardown{success,failed}`, `Launch{cold,warm,freebusy,nocapacity,limit,ratelimited,freeip}`,
  `PoolAvailable/Leased/Stuck`, `WarmRun`/`ReapRun` heartbeats, `Healed`, `EngineError`.
  `poolCounts()` added to labinfra.
- **Setup script** `engine/deploy/setup-observability.mjs` (idempotent, run from engine/):
  creates SNS topic **`ShieldSyncLabsAlerts`** + email sub to **info@** (CONFIRMED),
  a **`ShieldSyncLabs` CloudWatch dashboard**, and **8 alarms** → SNS: Deploy/Teardown-failed,
  EngineError, Lambda Errors, **PoolStarvation** (0 free ~15min), **PoolStuck** (drifted acct),
  **Reaper/Warmer-Stalled** (missing-heartbeat = cron died). Dashboard: CloudWatch → Dashboards
  → `ShieldSyncLabs` (us-east-1; sign into 750). Snapshots: `observability-snapshots/*.png`.
- **Org cost tripwire:** AWS Budget **`ShieldSync-Org-Monthly-Cost`** in mgmt acct **851**
  ($100/mo; alerts $50/$90/forecast>$100 → info@), on top of per-acct $10 budgets.

### Reliability
- **Pool self-heal** `healPool()` (labinfra) runs each reap (~3min): reclaims drifted accounts
  — leased-but-session-settled → `releaseAccount`; hung cold deploy (session "leasing" >12min)
  → `teardown`. Conservative; leaves ambiguous cases to the PoolStuck alarm. Emits `Healed`.
- **Deploy resilience:** CFN + STS clients use `maxAttempts:5 retryMode:"adaptive"` (ride out
  throttling under bursts); `CreateStack OnFailure` `DO_NOTHING`→**`DELETE`** (failed stacks
  auto-clean, account recycles, name free on retry).
- **Concurrent cold-launch stress test** `engine/load-test-concurrent.mjs` — 5 simultaneous IAM
  launches (warmer only warms s3 → forces cold): **10/10** — exactly 3 lease on distinct accounts
  (no double-lease), 2 clean `NO_CAPACITY`, 3 cold deploys ~83–110s no CREATE_FAILED, concurrent
  teardown restores the pool. **Capacity insight:** teardown recycle ~5–6min, so a burst drops
  usable free capacity to ~0 for minutes — the real argument for the AWS account-limit increase.

### Abuse guards (per-user AND per-IP — see also §6b)
- App forwards Cloudflare **`CF-Connecting-IP`** → engine `hashIp()` (salted sha256, **raw IP
  never stored**) → two `/launch` checks: **rate cap ≥8 launches/10min/IP → 429 `RATE_LIMITED`**;
  **free multi-account guard ≥3 free/48h/IP → 429 `FREE_IP_LIMIT`**. Together with the per-user
  cooldown (Cognito sub) + H3 lock = both layers. (VPN-retry on the SAME account is stopped by
  the per-user cap, which keys on the sub not the IP.) `ipHash` on session rows; `ipLaunchCount`/
  `freeIpCount` in labinfra. **Cloudflare WAF rate-limit rule** on `/api/launch` (10 req/10s/IP,
  Block 10s) added in the dashboard (Free-plan period = 10s).
- **Error-UX:** `launcherror` + `nocapacity` cards now reassure + offer **Try again + Contact
  support** (`SUPPORT_URL` = shieldsyncsecurity.com/contact); 429 cards branch on RATE_LIMITED /
  FREE_IP_LIMIT / LIMIT_REACHED. **"Open AWS console" no longer fails silently** — shows
  "Opening console…" then an inline error (try again / incognito / contact) if the mint fails.
- **Audit lows fixed:** sessionId is CSPRNG (`randomBytes`, was Math.random); `hashIp` salt is the
  per-deployment `ENGINE_SHARED_SECRET` (not a source constant).

### Lab content / catalogue UX
- **Beginner-friendly s3 guide:** every fix now shows **🖱️ Console click-path AND ⌨️ CLI**, plus a
  "Before you start" orientation (two panes, open-console, the one-AWS-session-per-browser gotcha,
  console-vs-CloudShell, Check-my-work). **Free cooldown 48h→24h** (§6b).
- **⚙️ Lab-content workflow (IMPORTANT):** the app renders `app/lib/lab-content.ts`, which is now
  **generated** from `app/content/labs/<slug>/{instructions.md,lab.json}` by
  **`app/scripts/build-lab-content.mjs`**. To edit a lab guide: edit the `.md`, run
  `node scripts/build-lab-content.mjs` (from app/), commit both. (Don't hand-edit lab-content.ts.)
- **SOC demoted to "Coming soon" (marketing repo, cross-repo):** SIEM/SOAR were advertised + priced
  + checkout-able but the 4 SOC slugs 404 — a dead-end. Now: homepage badges "Coming soon", wizard
  SOC track disabled + `?track=soc` neutralized, SOC `/labs/[slug]` pages show Coming-soon + drop
  the false grader promise, `/labs/soc` CTAs → "Get notified". AWS funnel untouched.

### New DynamoDB tables this session
`ShieldSyncLabOrders` (payments, §6d). (Plus `ShieldSyncLabUserLocks` + `ShieldSyncLabQueue` earlier.)

---

## 7. Launch-hardening incident log (June 2026)

What broke and how it was fixed, in order:

1. **App->Engine chain returned empty / 502** — the Worker had no `ENGINE_URL`, so it
   fell back to `http://localhost:4000`. **Fix:** added the `vars` block to
   `wrangler.jsonc` and redeployed.

2. **Every page 500'd with `ChunkLoadError`** — Next 16 built with Turbopack; its SSR
   chunks are incompatible with OpenNext on Workers. **Fix:** `build` -> `next build --webpack`.

3. **Sign-in: "pick Google account -> nothing happens"** — Google consent screen was in
   **Testing** with zero test users. **Fix:** publish the app (-> In production).

4. **Sign-in: `error=auth_failed`** — `COGNITO_CLIENT_SECRET` contained a stray
   non-Latin1 char (smart-quote from interactive entry), so `btoa(id:secret)` threw.
   **Fix:** re-set secrets with clean ASCII via `printf '%s' ... | wrangler secret put`;
   `cognito.ts` now uses a UTF-8-safe `basicAuth()`. Also: JWKS is created per-request
   (a module-cached jose `createRemoteJWKSet` throws "Cannot perform I/O..." in workerd).

5. **Marketing user-persist silently never ran** — the callback's fire-and-forget
   `fetch(ENGINE_URL/user)` is cancelled by the Workers runtime once the response
   returns. **Fix:** wrap the persist in `after()` from `next/server` (-> `ctx.waitUntil`).

6. **Labs `CREATE_FAILED` — no reaper** — abandoned sessions were never swept, so
   accounts drifted (DDB `available` while AWS held a stale stack) -> launch collisions.
   **Fix:** wired `reap()` into a `reap` worker action + EventBridge `ShieldSyncReaper`
   `rate(3 min)`.

7. **Engine shipped lab templates under mangled paths -> `ENOENT` on every launch** —
   `deploy.ps1` rel-path substring ate 10 chars because `Get-ChildItem` resolves the
   `..`. **Fix:** compute rel path from `(Resolve-Path .../labs).Path` + prepend `labs/`.
   **Always verify `engine.zip` entries are `labs/<slug>/template.yaml` after a deploy.**

> **Cloudflare Workers rule:** ANY post-response side effect must go through `after()` /
> `ctx.waitUntil`. A bare `fetch(...).catch(()=>{})` after the response **silently never
> happens** — no error, just no effect.

---

## 8. Troubleshooting (symptom -> cause -> fix)

| Symptom | Most likely cause | Fix |
|---|---|---|
| Every page 500s, logs show `ChunkLoadError` | Built with Turbopack | Ensure `build` = `next build --webpack`; rebuild |
| `/api/launch` 502, `/api/entitlements` empty | `ENGINE_URL` not set in Worker | Confirm `vars.ENGINE_URL` in `wrangler.jsonc`; redeploy |
| Any engine call 401 `unauthorized` | `ENGINE_SHARED_SECRET` missing/mismatched between Worker and Lambda env | Re-set the Worker secret to match the Lambda's `ENGINE_SHARED_SECRET` env var |
| CI deploy fails `Authentication error [code: 10000]` | `CLOUDFLARE_API_TOKEN` scoped to the wrong CF account | Recreate the token under the **info@shieldsyncsecurity.com** login (acct `0ffe...2e4e9`) |
| Script can't reach engine: `ENOTFOUND *.on.aws` | Function-URL host not resolvable on this ISP / sandbox-blocked | Use the API Gateway base; run with `dangerouslyDisableSandbox` |
| Pick Google account -> stays on Google | GCP consent in Testing, or redirect URI missing | Publish app; verify Cognito `/oauth2/idpresponse` redirect URI |
| `/sign-in?error=auth_failed` | Throw in `exchangeCode`/`verifyIdToken` | btoa-Latin1 = bad secret byte; `invalid_client` = wrong secret; jose iss/aud = wrong pool/client id; "Cannot perform I/O" = JWKS module cache |
| Login works but no row in `ShieldSyncLabUsers` | Fire-and-forget `fetch` cancelled on Workers | Wrap the side-effect in `after()` |
| Lab launch -> `CREATE_FAILED` repeatedly | Account `available` in DDB but holds a stale stack | Nuke the stale stacks, reconcile DDB, run the reaper. Template is NOT the problem |
| Launch session -> `error`, log `ENOENT .../labs/<slug>/template.yaml` | `deploy.ps1` packaged templates under mangled paths | Fix rel-path calc, redeploy, verify `engine.zip` entries |
| "You've used all your launches" during testing | Free cap = 1 launch / 24h hit | `node engine/try-reset-rate.mjs s3-misconfiguration-audit 72` (flips ended sessions to error) |
| Launch reconnects instead of showing the wait-room | The user already has a live session for that lab (the already-active check runs before the capacity gate) | End the live lab first; or it's working as designed |

Read live Worker logs: `npx wrangler tail --format pretty` (from `app/`).
Engine logs: CloudWatch `/aws/lambda/ShieldSyncEngine` (assume into 750 first).

---

## 9. Known issues / pending work

- **`COGNITO_CLIENT_SECRET` rotation (your action, PENDING):** Cognito has **no
  in-place client-secret rotation**. It requires creating a NEW app client (new
  CLIENT_ID), re-pointing callbacks + the Google IdP, swapping `COGNITO_CLIENT_ID` +
  `COGNITO_CLIENT_SECRET`, re-testing Google sign-in, then deleting the old client. It's
  live-auth surgery (needs you present to re-test) — and the secret isn't web-exposed, so
  lower urgency. (`SESSION_SECRET` was already rotated 2026-06-22.)
- **Pool scaling is blocked on an AWS account-limit increase (your action):** the org
  caps at its applied "Maximum number of accounts" = **5** (= current count). NOT
  self-service (`get-service-quota` -> `NoSuchResourceException`); raise it via **AWS
  Support / console** (Organizations -> Number of accounts). After approval,
  `node engine/try-provision.mjs <NNN>` vends a sandbox (create + bootstrap
  `LabExec`/`LabUser` + $10/mo budget + register in pool). The free-pool cap scales with
  the pool. **Then flip `FREE_POOL_PCT` back to ~0.3 once paid is live.**
- **Paytm / paid tier (awaiting merchant approval, expected days):** mock-pay is OFF in
  prod, so **only the free lab is a working purchasable product right now**. The full Paytm
  path (JS Checkout + server-to-server confirm/callback + engine `/orders`) is BUILT and the
  trust model hardened (6d). Before `PAYMENTS_LIVE=1`: flip `PAYTM_ENV`→production, set the
  production merchant-key secret, run the e2e verification, do the pre-live security batch,
  and revert `FREE_POOL_PCT` to ~0.3. (Razorpay was dropped 2026-07-03 — owner decision.)
- **Cognito Google attribute mapping is mis-wired but INERT — do NOT "fix" casually:**
  `family_name <- given_name`, `given_name`/`email_verified` unmapped. It's load-bearing
  (keeps the required `family_name` populated for federated creation, which happens
  before any trigger runs). `family_name` is read in exactly one never-firing fallback;
  the marketing table stores the correct `name`. A naive remap locks out mononym Google
  accounts (incl. the owner's "Himanshu"). Only correct fix = recreate the pool with
  `family_name`/`name` OPTIONAL (disruptive; would pair well with the CLIENT_SECRET
  rotation since both need a new/recreated client).
- **Catalogue = 2 labs (s3 + iam).** New lab content is the owner's to design (15 yrs
  cybersecurity exp). Standing RULE: every new lab MUST ship an auto-grader
  (`successCriteria` + a working `gradeXxx()` in `graders.mjs`, added to deploy.ps1's
  zip line) and be verified fresh-fails / remediated-passes before `ready:true`.
- **Catalogue is defined in two repos** (labs `app/lib/labs.ts` vs marketing
  `lib/site.ts`) and access rules in three files (6b) — a future consolidation to shared
  config would remove the drift risk, but that's a cross-repo change, not pre-launch.
- **Minor UX:** none currently open. (The sticky lab-panel "below the fold on short
  windows" issue was fixed 2026-06-24 — the panel caps to `100vh` and scrolls internally.)

---

## 10. Quick reference

| Thing | Value |
|---|---|
| App (custom domain) | `https://labs.shieldsyncsecurity.com` |
| App (workers.dev) | `https://labs-platform.sparkling-dew-f01e.workers.dev` |
| Admin ratings (gated) | `https://labs.shieldsyncsecurity.com/admin/ratings` |
| Worker name | `labs-platform` |
| Engine API | `https://lewssnjjhi.execute-api.us-east-1.amazonaws.com` (API GW — NOT the Function URL) |
| Cognito pool | `us-east-1_5Hu20LAi8` (acct 851236938541) |
| Cognito app client | `36s7i98jnt0mj8n5m8h0s711kn` |
| Cognito Hosted UI | `shieldsync-labs.auth.us-east-1.amazoncognito.com` |
| Google OAuth client | `301695920084-3f1l4jjjoetn70g6pstq87jrmini24vb.apps.googleusercontent.com` |
| Engine/infra AWS acct | `750294427884` (mgmt 851236938541; sandboxes 511.../244.../350...) |
| CF account (Workers live here) | `0ffe012ec833f7c0d329fbddeba2e4e9` (info@shieldsyncsecurity.com login) |
| App deploy | CI on push to `master` (app/**); manual = `npm run cf:deploy` from `app/` |
| Engine deploy | `engine/deploy/deploy.ps1` (assumes into 750 -> zip -> S3 -> Lambda -> put-role-policy) |
| App logs / engine logs | `npx wrangler tail` / CloudWatch `/aws/lambda/ShieldSyncEngine` (acct 750) |
| DynamoDB tables (750) | Accounts, Sessions, Users, Entitlements, Ratings, UserLocks, Queue |
| Crons (750) | `ShieldSyncReaper` `rate(3 min)`, `ShieldSyncWarmer` `rate(10 min)` |
| Cross-account access | assume `arn:aws:iam::<acct>:role/OrganizationAccountAccessRole` from mgmt (851); org `o-v0q5eumtob` |
