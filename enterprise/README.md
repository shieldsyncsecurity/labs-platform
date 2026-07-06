# ShieldSync Enterprise

Next.js app on Cloudflare Workers (via OpenNext) for ShieldSync's B2B enterprise product:
real-world cloud security assessments for hiring. Sibling of `labs-platform/app/` (the B2C
labs product) — same toolchain, separate Worker, separate engine.

## Build — read this before touching CI/deploy

**Production builds MUST use `next build --webpack`** (already wired as the `build` /
`cf:build` / `cf:deploy` npm scripts). Turbopack breaks OpenNext's Cloudflare output — this
bit the labs app in production before it was pinned to webpack. Do not "helpfully" switch
this back to plain `next build` (which defaults to Turbopack in Next 16).

Dev runs on port **3002** (`next dev -p 3002`) — deliberately different from the labs app's
3001, and outside the Windows-reserved port ranges (7544-8043, 8082-8281).

## What this app does today

- Landing page (`app/page.tsx`) — headline, "Book a walkthrough" mailto CTA, "View a sample
  report" link.
- `app/demo/report` — placeholder for the sample-report view (TODO, not built).
- A server-only engine client (`lib/server/ent-engine.ts`) that proxies to the **enterprise
  engine** (a separate backend from the labs engine) using a shared secret
  (`ENT_ENGINE_SECRET`) attached to the `x-engine-token` header. This secret is read only in
  that one module and never reaches the browser.
- Candidate-facing API routes (`app/api/...`) that call the engine server-side and return
  JSON to the browser:
  - `GET  /api/invite/[token]` — resolve an invite token to its sanitized invite record.
  - `POST /api/consent` — record consent for an invite.
  - `POST /api/otp/send` — send an OTP for the invite's registered contact.
  - `POST /api/otp/verify` — verify the OTP code.

## Employer portal (`app/portal/*`, `app/api/portal/*`)

Built, but auth is a placeholder:

- **Session chokepoint**: `lib/server/portal-session.ts` exports `getOrgId()` /
  `setOrgIdCookie()` / `clearOrgId()`, backed by an httpOnly `ss_ent_org` cookie. Every
  portal page/action/API route calls `getOrgId()` and uses ONLY that value as the orgId sent
  to the engine — orgId from a request body/query is never trusted.
- **Sign-in today is DEV-ONLY**: `/portal/login` posts to `/api/portal/dev-login`, which
  confirms the pasted org id exists (`GET /ent/orgs`) before stamping the cookie. Gated by
  the `PORTAL_DEV_LOGIN` env var. TODO: replace entirely with Cognito enterprise-pool auth
  (email+password+TOTP); orgId will come from the verified session's `custom:orgId` claim.
- **Org isolation**: `/portal/assessments/[id]` re-fetches the assessment and 404s if
  `assessment.orgId !== sessionOrgId` (so a guessed id from another org is indistinguishable
  from a typo). The invite create/revoke API routes do the same ownership check before
  calling the engine.
- Pages: `/portal` (dashboard: credits + assessments list), `/portal/assessments/new`
  (create), `/portal/assessments/[id]` (report link, add candidate, invites table with
  copy/revoke), `/portal/billing` (credits + order history + "request more" mailto).

## What is deliberately NOT built yet (TODO)

- **Real employer auth.** `SESSION_SECRET` is reserved for this once Cognito replaces the
  dev cookie described above.
- **Candidate assessment room** (the live graded environment itself).
- **Reports UI** (the real version of `/demo/report` — findings, scoring, timeline).
- **Admin.**

## Environment

See `.env.example`. Locally, copy it to `.env.local` and fill in `ENT_ENGINE_URL` (point at a
local enterprise-engine instance) and `ENT_ENGINE_SECRET`. In Cloudflare, `ENT_ENGINE_SECRET`
and `SESSION_SECRET` must be set via `wrangler secret put`, never added to `wrangler.jsonc`
`vars` (vars are visible in the dashboard/config; secrets are not).
