# ShieldSync Labs — Auth & Deploy Runbook

> Last updated: 2026-06-11. Living doc. No secret **values** live here on purpose —
> only their names and where they're stored. Actual values: `app/.env.local`
> (gitignored, local) and Cloudflare Worker secrets (prod).

This is the operational reference for the **ShieldSync Labs platform**
(`labs.shieldsyncsecurity.com`) — the hands-on AWS security labs product. It
covers the architecture, the deploy process, the Cognito+Google auth wiring, the
gotchas that bit us during launch hardening, and the known pending work.

---

## 0. LIVE STATUS — read this first (2026-06-11)

**Everything in this table is DEPLOYED and verified. If a tracker/doc says any of
these is "not done / need to verify / wrangler not run / half-wired," that tracker is
STALE — THIS file is the source of truth.**

| Component | Status | Detail |
|---|---|---|
| App — Cloudflare Worker `labs-platform` | 🟢 **LIVE** | version `428796a8`; pages + auth + lab UI all 200 |
| Cognito + Google sign-in | 🟢 **LIVE** | Google OAuth app **In Production**; full login round-trip works |
| App → Engine wiring | 🟢 **WIRED** | `ENGINE_URL` set in `wrangler.jsonc` (NOT localhost); App→Engine→DDB verified |
| Engine Lambda `ShieldSyncEngine` (acct 750) | 🟢 **DEPLOYED** | redeployed 2026-06-11; `/health` 200 |
| Reaper + Warmer crons | 🟢 **LIVE** | EventBridge `ShieldSyncReaper rate(3 min)` (sweep abandoned) + `ShieldSyncWarmer rate(10 min)` (pre-stage); verified |
| Lab account pool | 🟢 **CLEAN** | 3 sandboxes `available`, 0 stacks |
| Marketing user-persist (`after()` fix) | 🟢 **VERIFIED** | a real login wrote through: `logins` 2→3, `lastSeen` → today |
| Lab launch / teardown | 🟢 **VERIFIED** | test launch → `active` in 72s, torn down clean |
| Access rules (session length + launch caps) | 🟢 **LIVE** | per-tier durations + launch limits; free = 1/48h **+ free-pool cap ≤30%**; verified (429, durations, 503 FREE_AT_CAPACITY). See §6b |
| UX polish | 🟢 **LIVE** | sign-out ends lab (instant `/api/end-lab`); 👍/👎 → `ShieldSyncLabRatings`; <5 min low-time warning |
| **Auto-grader** ("Check my work") | 🟢 **LIVE** | `/grade` scores a live lab vs its `successCriteria` from REAL account state (s3 + iam labs); verified fresh→0/4, remediated→PASS |
| Role-trust hygiene | 🟢 **DONE** | lab roles `:root` → `[ShieldSyncEngineRole, OrgAccountAccessRole]`; `LabExec` on existing 3 left as-is (protected by ProtectGovernance SCP). `FORCE_REFRESH` env var removed |
| Pool scaling past 5 accounts | 🔴 **BLOCKED** | AWS org account cap = **5** (at limit); needs a Support quota increase (your action). See §9 |
| Real Razorpay | 🟡 deferred | mock gateway works; real blocked on GST (~1 mo) |
| 2 lab CFNs (cloudtrail, guardduty) | 🔴 todo | content authored; need `template.yaml` + `ready:true` |

> **Cross-session note:** this file + the auto-memory (`project_shieldsync_labs.md`)
> are the source of truth. A *running* Claude session loaded its memory at its own
> start, so it won't see later updates until it re-reads this file or restarts —
> point stale sessions here. The deployed state is committed + pushed (latest `b26789b`); 3 sessions
> share the tree, so commit path-scoped, never blanket `git add -A`.

---

## 1. What this is

A Next.js app that sells/serves browser-based AWS security labs. A user signs in
(Google via Cognito), pays (mock gateway now; Razorpay later), and launches a lab
that leases a throwaway AWS account brokered by a backend "engine" Lambda.

- **Frontend/app:** Next.js 16 on **Cloudflare Workers** (via the OpenNext adapter).
- **Engine:** AWS Lambda behind API Gateway; owns AWS creds, leases lab accounts,
  writes entitlements/sessions/users to DynamoDB.
- **Auth:** Amazon Cognito Hosted UI federating Google (and LinkedIn, configured
  but Google is the live path).

---

## 2. Architecture & the AWS org (5 accounts, full cross-account access)

The CLI creds (`apiuserforclaude`) are the **org MANAGEMENT account** (`851`), so you
can reach **every** member account by assuming a role — there is no access wall:

| Concern | AWS account | Notes |
|---|---|---|
| **Mgmt + Cognito** — CLI creds `apiuserforclaude`, Cognito user pool | **851236938541** ("ShieldSync Labs") | `aws sts get-caller-identity` returns this; it's the org master of `o-v0q5eumtob`. |
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

> ⚠️ Gotcha that cost time: `aws dynamodb list-tables` / `aws lambda get-function`
> with the *default* (851) creds returns empty / "not found" — that does NOT mean no
> access; it means you queried the wrong account. **Assume `OrganizationAccountAccessRole`
> into 750 first.** (`engine/deploy/deploy.ps1` and `labinfra.mjs` do exactly this.)

```
Browser ── Cloudflare Worker (labs-platform) ──HTTP──> Engine API Gateway ──> Lambda ──> DynamoDB
   │              (Next.js app)                          (acct 750294427884)
   └── Cognito Hosted UI (acct 851236938541) ── Google OAuth (GCP project 301695920084)
```

---

## 3. Tech stack & the CRITICAL build rule

- Next.js **16.2.7**, React 19.2.4
- `@opennextjs/cloudflare` **1.19.11**, `wrangler` 4.99
- Tailwind v4

### ⚠️ Production builds MUST use webpack, not Turbopack

Next 16 defaults `next build` to **Turbopack**. Turbopack emits SSR chunks named
`server/chunks/ssr/[root-of-the-server]__*._.js` that **`@opennextjs/cloudflare`
cannot load at runtime** → the deployed Worker throws
`ChunkLoadError: Failed to load chunk ...` and every page 500s.

**The fix is already wired in** and must not be reverted:
- `app/package.json` → `"build": "next build --webpack"`
- `app/next.config.ts` keeps `turbopack: { root: process.cwd() }` for **dev only**
  (it pins the workspace root because a sibling `labs-platform/package-lock.json`
  otherwise gets inferred as root and breaks module resolution). This does NOT
  enable Turbopack for prod because `cf:build` runs `npm run build` = `--webpack`.

Verify a build is clean: there should be **no** `[root-of-the-server]` files under
`app/.next/server/`.

---

## 4. Deploy process

From `app/`:

```powershell
# Build (uses webpack via the build script) + bundle for Cloudflare
npx opennextjs-cloudflare build

# Deploy to the live Worker "labs-platform"
npx wrangler deploy
```

`npm run cf:deploy` does both. Notes:
- The Worker is named **`labs-platform`** in `app/wrangler.jsonc`. Do not rename it
  to `shieldsync-labs` (an earlier mistake created an empty stray Worker by that
  name — clean it up if it still exists).
- Deploys do **not** wipe secrets; secrets are managed separately (see §6).
- Non-secret config (`ENGINE_URL`, Cognito IDs, `APP_URL`, etc.) lives in the
  `vars` block of `wrangler.jsonc` and is shown in the deploy output's bindings list.
- Live URLs: `https://labs.shieldsyncsecurity.com` (custom domain) and
  `https://labs-platform.sparkling-dew-f01e.workers.dev`.

---

## 5. Cognito + Google auth

### Cognito (account 851236938541, region us-east-1)
- **User pool:** `us-east-1_5Hu20LAi8` ("ShieldSync Pool")
- **App client:** `36s7i98jnt0mj8n5m8h0s711kn` ("ShieldSync-Web"); has a client secret;
  Allowed OAuth flow = `code`; scopes = `openid email profile`.
- **Hosted UI domain:** `shieldsync-labs.auth.us-east-1.amazoncognito.com`
- **App client Callback URLs** (the App↔Cognito leg):
  - `https://labs.shieldsyncsecurity.com/api/auth/callback`
  - `https://labs-platform.sparkling-dew-f01e.workers.dev/api/auth/callback`
  - `http://localhost:3001/api/auth/callback`

### Google OAuth (GCP project 301695920084)
- **OAuth client id:** `301695920084-3f1l4jjjoetn70g6pstq87jrmini24vb.apps.googleusercontent.com`
- **Authorized redirect URI** (the Cognito↔Google leg — NOT the app URL):
  `https://shieldsync-labs.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- **Authorized JavaScript origin:** `https://shieldsync-labs.auth.us-east-1.amazoncognito.com`
- **Publishing status:** **In production** (was "Testing" → published 2026-06-11 so
  any Google account can sign in; scopes are non-sensitive so no Google verification
  review is required).

### The OAuth flow (and where each leg can break)
1. App `/api/auth/login` → 302 to Cognito `/oauth2/authorize?identity_provider=Google` (sets a short-lived `ss_oauth_state` CSRF cookie).
2. Cognito → 302 to Google consent (Google client_id, redirect_uri = Cognito `/oauth2/idpresponse`).
3. User picks account / consents.
4. Google → 302 to Cognito `/oauth2/idpresponse`.
5. Cognito provisions/updates the pool user (must satisfy required attrs), mints its own code.
6. Cognito → 302 to app `/api/auth/callback?code=...&state=...`.
7. App callback: exchanges code at Cognito `/oauth2/token`, verifies the id_token
   (jose/JWKS), sets the `ss_session` cookie, redirects to `/dashboard`.

Code: `app/lib/auth/cognito.ts` (server), `app/app/api/auth/*` (routes),
`app/lib/auth/context.tsx` + `cognito-adapter.ts` (client). Client mode is gated on
`NEXT_PUBLIC_AUTH_MODE === "cognito"` (baked at build time from `.env.local`).

---

## 6. Environment variables & secrets

**Non-secret** → `app/wrangler.jsonc` `vars` (prod) and `app/.env.local` (local):
`ENGINE_URL`, `NEXT_PUBLIC_AUTH_MODE=cognito`, `COGNITO_REGION`, `COGNITO_DOMAIN`,
`COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `APP_URL`.

- `APP_URL` is `https://labs.shieldsyncsecurity.com` in prod (drives the
  `redirect_uri`); `http://localhost:3001` locally.

**Secrets** → Cloudflare Worker secrets (prod) + `app/.env.local` (local):
`COGNITO_CLIENT_SECRET`, `SESSION_SECRET`. Set/rotate with:

```powershell
# Pipe clean ASCII bytes — do NOT type the value interactively in PowerShell,
# smart-quotes/encoding can inject a non-Latin1 char (see incident #3).
printf '%s' '<value>' | npx wrangler secret put COGNITO_CLIENT_SECRET   # via Bash tool
```

`ENGINE_URL` is the engine **API Gateway**:
`https://lewssnjjhi.execute-api.us-east-1.amazonaws.com` (not a Lambda Function URL).
Engine DynamoDB tables (acct 750294427884): `ShieldSyncLabAccounts`,
`ShieldSyncLabSessions`, `ShieldSyncLabUsers`, `ShieldSyncLabEntitlements`,
`ShieldSyncLabRatings`. EventBridge crons (acct 750): `ShieldSyncReaper`
(`rate(3 min)`→reap), `ShieldSyncWarmer` (`rate(10 min)`→warm).

---

## 6b. Access rules — session length & launch limits (set 2026-06-11)

**Single source:** `app/lib/access-rules.ts` (app) + `engine/labinfra.mjs`
`LEVEL_RULES`/`FREE_RULE` (engine, authoritative). Keep the two in sync.

| Tier | Session length | Launches | Window | Verified |
|---|---|---|---|---|
| **Free lab** (`free:true`, e.g. `s3`) | 30 min | **1×** | 48 h | ✅ 429 on 2nd |
| **Beginner** (paid) | 30 min | 3× | 72 h | — |
| **Intermediate** | 60 min | 2× | 48 h | ✅ 60 min |
| **Advanced** | 120 min | 2× | 48 h | — |
| **Monthly** sub | per-lab length | unlimited | 30-day entitlement | — |

- **Session length** = how long one live run lasts before the reaper kills it. Set by
  `handler.mjs /launch` → `lease(uid, slug, rules.sessionMinutes)`.
- **Launch limit** = rolling count of a user's runs for that lab (`launchCount()`),
  excluding failed deploys. Over the cap → engine returns **429 `LIMIT_REACHED`**
  (app `/api/launch` relays it). Reconnecting to an *active* session doesn't count.
- **Free-pool cap** = free labs may occupy at most **30%** of the whole account pool
  at once (`FREE_POOL_PCT` in labinfra, min 1 slot), so a free rush can't starve
  paying users — paid launches skip the cap and use the rest. Over it → engine
  returns **503 `FREE_AT_CAPACITY`**, which the lab console shows as "Free labs are at
  capacity." Scales with the pool (20 accts → 6 free). Verified on a 3-acct pool
  (cap 1): a 2nd concurrent free launch is blocked while a paid launch still succeeds.
- **Entitlement window** (`accessUntil`, paid only) is set per-lab in
  `checkout/route.ts` to match the launch window. The free lab has no entitlement —
  the engine cap is the only gate.
- Level/free come from each lab's `lab.json` (bundled into the Lambda); `rulesFor()`
  reads it.

---

## 7. Launch-hardening incident log (June 2026)

What broke and how it was fixed, in order:

1. **App→Engine chain returned empty / 502** — the Worker had no `ENGINE_URL`, so
   `store.ts` fell back to `http://localhost:4000`. **Fix:** added the `vars` block
   to `wrangler.jsonc` (`ENGINE_URL` + all Cognito vars) and redeployed.

2. **Every page 500'd with `ChunkLoadError`** — Next 16 built with Turbopack; its
   SSR chunks are incompatible with OpenNext on Workers. **Fix:** `build` script →
   `next build --webpack` (see §3).

3. **Sign-in: "pick Google account → nothing happens"** — Google OAuth consent
   screen was in **Testing** mode with **zero test users**, so Google silently
   blocked every account after selection. **Fix:** **Publish app** (→ In production).

4. **Sign-in: `/sign-in?error=auth_failed`** — `COGNITO_CLIENT_SECRET` stored in the
   Worker contained a stray **non-Latin1 character** (likely a smart-quote injected
   when the secret was set interactively), so `btoa(\`id:secret\`)` in `exchangeCode`
   threw *"btoa() can only operate on characters in the Latin1 range."* **Fix:**
   re-set both secrets with clean ASCII via `printf '%s' ... | wrangler secret put`.

5. **Hardening (deployed, version `5f720c81`):**
   - `cognito.ts` Basic-auth encoding is now **UTF-8-safe** (`basicAuth()` helper) so
     a stray secret byte can never crash the token exchange again.
   - JWKS is created **per-request** (not module-cached) — a module-scoped jose
     `createRemoteJWKSet` reused across requests throws *"Cannot perform I/O on
     behalf of a different request"* in workerd → intermittent `auth_failed`.
   - Removed a temporary `&detail=<error>` debug param from the callback (it had
     been added to surface the btoa error; it leaks internal error text into URLs).

6. **Marketing user-persist silently never ran** (found 2026-06-11; **FIXED + DEPLOYED**
   Worker `9b162d59`) — the callback's fire-and-forget `fetch(ENGINE_URL/user)` is
   cancelled by the Workers runtime the moment the response returns, so
   `ShieldSyncLabUsers` got **zero writes** in prod (only the Jun-9 Node-dev row
   existed; verified live). **Fix:** wrap the persist in `after()` from `next/server`
   (maps to `ctx.waitUntil`; OpenNext uses waitUntil throughout its cache/queue/tag
   layers). Grep-verified this was the only fire-and-forget site. *Verify:* a fresh
   login should bump that user's `lastSeen`/`logins` in `ShieldSyncLabUsers`.

7. **Labs failed (`CREATE_FAILED`) — no reaper** (found + **FIXED + DEPLOYED**
   2026-06-11) — abandoned sessions (sign-out / tab-close never call `/end-lab`) were
   never swept, so accounts drifted (DDB `available` while AWS held a stale stack) →
   launch collisions. **Fix:** wired the existing `reap()` (labinfra.mjs) into a
   `reap` worker action in `handler.mjs`, deployed the engine Lambda, and created an
   **EventBridge rule `ShieldSyncReaper` = `rate(3 minutes)`** (acct 750294427884)
   that invokes it with `{_worker:true,action:"reap"}`. Verified: reap ran clean
   (`checked 0, expired 0, reaped 0`); pool clean (3 accts available, 0 stacks). See §9.

8. **Engine deploy shipped lab templates under mangled paths → `ENOENT` on every lab
   launch** (found + **FIXED + VERIFIED** 2026-06-11) — `deploy.ps1` built the zip
   entry path as `FullName.Substring(("$SCRIPT_DIR\..\").Length)`, but `Get-ChildItem`
   **resolves the `..`**, so the substring ate 10 chars and templates landed as
   `sconfiguration-audit/template.yaml` instead of
   `labs/s3-misconfiguration-audit/template.yaml`. The Lambda then threw
   `ENOENT … /var/task/labs/<slug>/template.yaml` in `deployLab`→`readFileSync`.
   **Fix:** compute the rel path from `(Resolve-Path "$SCRIPT_DIR\..\labs").Path` and
   prepend `labs/`. **Always verify the package** after a deploy: open
   `engine/deploy/engine.zip` and confirm entries read `labs/<slug>/template.yaml`.
   Verified: test launch reached `active` in 72s, then torn down clean.

> ⚠️ **Cloudflare Workers rule:** ANY post-response side effect must go through
> `after()` / `ctx.waitUntil`. A bare `fetch(...).catch(()=>{})` after the response
> is returned **silently never happens** — no error, just no effect.

> Debugging tip used here: to read a server-side callback error without live logs,
> temporarily append `&detail=${encodeURIComponent(msg)}` to the error redirect,
> reproduce, read the URL, then **remove it before shipping**.

---

## 8. Troubleshooting (symptom → cause → fix)

| Symptom | Most likely cause | Fix |
|---|---|---|
| Every page 500s, logs show `ChunkLoadError` | Built with Turbopack | Ensure `build` = `next build --webpack`; rebuild |
| `/api/launch` 502, `/api/entitlements` empty | `ENGINE_URL` not set in Worker | Confirm `vars.ENGINE_URL` in `wrangler.jsonc`; redeploy |
| Pick Google account → stays on Google, no redirect | GCP consent in Testing w/o test user, OR Google redirect-URI missing the Cognito `/oauth2/idpresponse` | Publish app or add test user; verify redirect URI |
| `/sign-in?error=auth_failed` | Throw in `exchangeCode`/`verifyIdToken` | Temp-add `&detail=`; read it: `btoa ... Latin1` = bad secret; `invalid_client` = wrong secret; jose `iss/aud` = wrong pool/client id env; `Cannot perform I/O...` = JWKS module cache |
| `/sign-in?error=bad_state` | `ss_oauth_state` cookie missing/expired (10 min TTL) or cross-site | Retry from `/sign-in`; check cookies are `Secure` over HTTPS |
| `/sign-in?error=not_configured` | A Cognito env var/secret missing in Worker | Check `wrangler.jsonc` vars + `wrangler secret list` |
| Login works but no row in `ShieldSyncLabUsers` | Fire-and-forget `fetch` cancelled on Workers after the response returns | Wrap the side-effect in `after()` from `next/server` (→ `ctx.waitUntil`) |
| Lab launch → stack `CREATE_FAILED` (repeatedly) | Account marked **available** in DynamoDB but still holds a stale `CREATE_COMPLETE` stack — reaper not running, so an expired session was never torn down → per-account name collision | Tear down / nuke the stale stacks, reconcile the account's DDB status to truly-available, run the reaper. See §9 "teardown gap". Template is NOT the problem. |
| Lab launch session goes to `error`, log shows `ENOENT … /var/task/labs/<slug>/template.yaml` | `deploy.ps1` packaged the lab templates under mangled paths (the `..`-resolution substring bug) so they're missing/misnamed in the Lambda | Fix `deploy.ps1` rel-path calc (Resolve-Path + prepend `labs/`), redeploy, and **verify `engine/deploy/engine.zip` entries are `labs/<slug>/template.yaml`**. See incident #8. |

Read live Worker logs: `npx wrangler tail --format pretty` (from `app/`).

---

## 9. Known issues / pending work

- **Cognito Google attribute mapping is mis-wired — but INERT; DO NOT "fix" it
  casually** (analyzed 2026-06-11): `family_name ← given_name` (surname slot holds the
  first name), `given_name` unmapped, `email_verified` unmapped (stored `false`).
  - **Why it's inert:** grep shows `family_name` is read in exactly ONE place —
    `app/app/api/auth/callback/route.ts:45`, a name *fallback* that only fires when
    `claims.name` is empty (Google always sends `name`, so it never fires). The
    marketing table (`ShieldSyncLabUsers`) stores `name` (correct), not `family_name`.
    So nothing meaningful consumes the wrong value.
  - **Why the "Lambda backfill" plan is WRONG:** Cognito rejects a federated user at
    *creation* when a **required** attribute is missing — that happens BEFORE any
    pre-signup trigger runs, so no Lambda can inject it. And `family_name`/`name` are
    Required with an **immutable** flag. The current `family_name ← given_name` mapping
    is precisely what keeps the required field populated → it's load-bearing.
  - **Why a naive remap is DANGEROUS:** flip to `family_name ← family_name` and any
    Google account with no surname fails the required-attribute check → locked out.
    The owner's own account (`himanshujain0911`, `name="Himanshu"`, single word) looks
    like exactly that mononym case. **Zero upside, real lock-out risk → leave it.**
  - **Only truly-correct fix:** recreate the pool with `family_name`/`name` OPTIONAL,
    then map correctly. Disruptive (new pool id → reconfigure app client, Google IdP,
    `wrangler.jsonc` vars). A planned migration, not a quick change. (`email_verified`
    could be mapped safely on its own, but it's also inert today.)
- **App changes DEPLOYED** (2026-06-11, Worker `9b162d59`): the `after()` callback fix
  (incident #6) **+** the animated terminal UX (`lab-panel.tsx` + `globals.css`
  `ss-bar`). Built with webpack, smoke-tested 8/8. Committed in `715ac2c`.
- **2 labs still need CFN templates** (have content, can't launch): `cloudtrail-forensics`,
  `guardduty-security-hub-triage`. The other 4 (iam/s3/kms/vpc) have `template.yaml` and
  are launchable.
- ✅ **`FORCE_REFRESH` env var removed** from the engine Lambda (2026-06-11).
- ✅ **Auto-grader DONE** (2026-06-11) — `engine/graders.mjs` scores a live lab vs its
  `successCriteria` from REAL account state: `/grade` (handler) → assume
  `ShieldSyncLabExec` → inspect (S3 policy-status/policy/BPA, IAM users/policies,
  `SimulatePrincipalPolicy`). App `/api/grade` + "Check my work" button (per-criterion
  ✅/⬜). Graders exist for **s3 + iam** (the launchable labs); add a `gradeXxx()` per new
  lab. **Gotcha:** a new grader file must be added to `deploy.ps1`'s `Compress-Archive`
  line or it won't ship. Verified: fresh lab → 0/4; after remediation → criteria flip to PASS.
  **📐 RULE (standing):** EVERY new lab MUST ship with an auto-grader (its
  `successCriteria` + a working `gradeXxx()`) — a lab without one is not "done". Verify
  against the real deployed lab (fresh fails, remediated passes) before marking it `ready`.
- ✅ **Role-trust tightening DONE** (2026-06-11) — lab roles `:root` →
  `[ShieldSyncEngineRole, OrganizationAccountAccessRole]`. `provision.mjs` sets it for
  future accounts (in the Root OU, before the SCP applies); `ShieldSyncLabUser` updated
  on the existing 3. `ShieldSyncLabExec` on the existing 3 could NOT be re-trusted in
  place — the **ProtectGovernance SCP** (`p-t63yhec3`) denies `UpdateAssumeRolePolicy` on
  it inside the OU (a deliberate guardrail; the role is also protected from tampering).
- **✅ Teardown gap → lab launches failed (FIXED + DEPLOYED 2026-06-11).**
  **Trigger = abandonment, not a broken teardown.** Sign-out (`context.tsx`
  `signOut()` → `cognitoSignOut()` → `/api/auth/logout`) **never calls
  `/api/end-lab`**; closing the tab only fires the client-side auto-end if the page
  is still open at expiry. Either way the session stays marked `active`/`leasing` and
  its `CREATE_COMPLETE` stack (auditor user + `sslab-data-<acct>` buckets) stays live
  in AWS — but DynamoDB still lists the account as **available**. State drift: DDB
  says free, AWS says occupied. The next launch grabs that account → per-account
  resource names collide → stack goes **`CREATE_FAILED`** (seen: one account with 7
  dead stacks over 1 live; the warm stack hit the same collision). Templates are fine
  (deploy clean in isolation) — purely a teardown/state gap.
  **Why it can't self-heal today:** `engine/handler.mjs` has worker actions for
  `deploy` / `teardown` / `warm` but **no `reap`**, and no EventBridge schedule
  invokes anything. A Lambda can't run a background timer (a `setInterval` only works
  in local `dev:lab`), so nothing sweeps abandoned sessions.
  **Fix (DONE 2026-06-11):** (a) pool cleaned — 3 accounts `available`, 0 stacks;
  (b) the existing `reap()` (labinfra.mjs) is now wired into a `reap` worker action in
  `handler.mjs` (engine Lambda redeployed via `engine/deploy/deploy.ps1`) and invoked
  by **EventBridge rule `ShieldSyncReaper` = `rate(3 minutes)`** in acct 750294427884,
  payload `{_worker:true,action:"reap"}`. Verified: reap ran clean (`checked 0,
  expired 0, reaped 0`). Abandonment is now safe — expired `active`/`leasing` sessions
  are swept within ~3 min, so the pool can't drift into collisions.
  *Done 2026-06-11:* `signOut()` now ends any live lab first (`context.tsx`, keepalive
  fetch → `/api/end-lab`) for instant release; and a **warmer cron** keeps the pool
  pre-staged — EventBridge **`ShieldSyncWarmer` = `rate(10 minutes)`** → Lambda
  `{_worker:true,action:"warm"}` (acct 750).
  **Manual reap** anytime: assume `OrganizationAccountAccessRole` into 750 and invoke
  the Lambda with `{_worker:true,action:"reap"}`, or run `node engine/try-reap.mjs`.
- **⚠️ Scaling the pool is blocked on an AWS account-limit increase.** The org caps at
  its applied "Maximum number of accounts" — currently **5** (= the count). New orgs
  get a low initial cap regardless of the documented default (10). This quota is NOT
  self-service (Service Quotas `get-service-quota` → `NoSuchResourceException`); raise
  it via **AWS Support / the console** (Service limit increase → Organizations →
  Number of accounts). After approval, `node engine/try-provision.mjs <NNN>` vends a
  sandbox (`sbxNNN@shieldsyncsecurity.com`): creates the account, bootstraps
  `ShieldSyncLabExec`/`ShieldSyncLabUser`, sets a $10/mo budget, registers it in the
  pool. The 30% free-pool cap scales automatically with pool size.
- **Lab ratings** (`/api/rate` → engine `/rate` → `ShieldSyncLabRatings` table, acct
  750) persist 👍/👎 per (labSlug, userId) for product signal. Done 2026-06-11.
- **Razorpay** integration deferred (~1 month, until GST) — mock gateway live now.

---

## 10. Quick reference

| Thing | Value |
|---|---|
| App (custom domain) | `https://labs.shieldsyncsecurity.com` |
| App (workers.dev) | `https://labs-platform.sparkling-dew-f01e.workers.dev` |
| Worker name | `labs-platform` |
| Engine API | `https://lewssnjjhi.execute-api.us-east-1.amazonaws.com` |
| Cognito pool | `us-east-1_5Hu20LAi8` (acct 851236938541) |
| Cognito app client | `36s7i98jnt0mj8n5m8h0s711kn` |
| Cognito Hosted UI | `shieldsync-labs.auth.us-east-1.amazoncognito.com` |
| Google OAuth client | `301695920084-3f1l4jjjoetn70g6pstq87jrmini24vb.apps.googleusercontent.com` |
| Engine/infra AWS acct | `750294427884` |
| App build / deploy | `npx opennextjs-cloudflare build` (webpack) → `npx wrangler deploy` |
| Engine deploy | `engine/deploy/deploy.ps1` (assumes into 750 → zip → S3 → Lambda) |
| App logs / engine logs | `npx wrangler tail` / CloudWatch `/aws/lambda/ShieldSyncEngine` (acct 750) |
| Latest app Worker version | `9b162d59` (2026-06-11 — after() + UI + auth hardening) |
| Reaper | EventBridge `ShieldSyncReaper` = `rate(3 minutes)` → engine Lambda (acct 750) |
| Cross-account access | assume `arn:aws:iam::<acct>:role/OrganizationAccountAccessRole` from mgmt (851); org `o-v0q5eumtob`, 5 accounts |
