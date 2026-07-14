# Paytm Go-Live Runbook — ✅ EXECUTED 2026-07-10, PAYMENTS ARE LIVE

> **Status: DONE.** Prod MID `LEfhcl08624319928201`, `PAYTM_WEBSITE=DEFAULT`, `PAYTM_ENV=production`,
> `PAYMENTS_LIVE=1`. First real payment verified: `order_4e06766e773b478d`, ₹249 captured, order
> `status=paid`, `PAY_PER_LAB` entitlement granted (30 launches / 7-day window). Kept below as the
> record of what was done + the rollback procedure.
>
> **Bug found and fixed at go-live:** `engine/handler.mjs` `/orders/paid` required
> `currency === order.currency`, but Paytm's `/v3/order/status` response body has **no `currency`
> field** — so confirm/callback forwarded `undefined` and the engine 400'd **every real payment**
> ("charged, no access"). Now currency is validated only when the provider supplies one;
> `amountMinor` stays strictly required (`Number(undefined)` → `NaN`, never matches), which is the
> real anti-forgery gate. Fixed + engine redeployed *before* the Worker opened, so no customer hit it.
>
> **Untestable-before-prod caveat:** `paymentsEnabled()` requires `PAYMENTS_LIVE=1` AND
> `PAYTM_ENV=production`, so the payment path **cannot be exercised on staging at all** — the first
> real test is necessarily a live charge. That interlock is good for safety but it's why the currency
> bug survived to go-live. If a second gateway is ever added, build a staging-exercisable path first.

Goal: **same-day go-live**. Everything below is pre-staged; the day Paytm approves, run top to bottom. Estimated total: ~2–3 hours including verification.

> Provider decision 2026-07-03: **Paytm only.** Razorpay code deleted (commit pending push).
> Trust path: `/api/payments/checkout` (creates order + initiates txn) → Paytm JS Checkout popup → `/api/payments/paytm/confirm` (server-to-server Order Status re-check) → engine `POST /orders/paid` (idempotent CAS) → entitlement grant. Redirect fallback: `/paytm/callback`.

## 0. Pre-flight (do NOW, before approval — no risk)
- [ ] Confirm the labs-app working tree is clean and CI is green (redesign + Razorpay-removal commits pushed).
- [ ] Confirm engine `/orders`, `/orders/paid`, `/entitlements/reserve-launch`, `/rollback-launch` respond (already verified 2026-06-25, commits `8dd205a`, `b6209fc` — re-smoke if engine was redeployed since).
- [ ] Legal pages review (privacy / terms / refund) — **owner action** (H7). Refund page matters most: Paytm disputes reference it.
- [ ] Draft the go-live announcement (LinkedIn + site banner) so marketing fires the same day.

## 1. Paytm production config (~15 min)
- [ ] From the Paytm dashboard (production): note **MID**, **merchant key**, **website name** (e.g. `DEFAULT`).
- [ ] `wrangler.jsonc`: set `PAYTM_ENV` = `production`, `PAYTM_MID` = prod MID, `PAYTM_WEBSITE` = prod website name.
- [ ] Set the production merchant key as a Worker secret (never in wrangler.jsonc):
      `npx wrangler secret put PAYTM_MERCHANT_KEY` (check `lib/payments/paytm.ts` for the exact env var name before running).
- [x] ~~In the Paytm dashboard, set the callback URL~~ — **WRONG, do not do this** (corrected 2026-07-10):
      the callback URL is passed **per-transaction** by `checkout/route.ts` with a required
      `?orderId=` param; a static dashboard webhook URL can't carry it. Leave the dashboard's
      "Webhook URL" page (Payment Notification URL etc.) EMPTY — configuring it would send
      order-less notifications that silently grant nothing.
- [ ] Housekeeping: if a `RAZORPAY_WEBHOOK_SECRET` Worker secret exists in the Cloudflare dashboard, delete it (code no longer reads it). (Checked 2026-07-10: not present.)

## 2. Pre-live security batch (audit #10 / #2 / #8 residuals) (~30 min)
- [ ] Re-verify paid-content gating (#10): anonymous + free-tier user cannot fetch a paid lab's walkthrough from `/api/lab-content` (expect 401/403).
- [ ] Re-verify signed engine identity token (#2) is enforced on per-session routes (tamper `x-user-id` → 401).
- [ ] Re-verify admin-access record (#8): `ADMIN_USER_IDS` contains only your Cognito sub.
- [ ] `ALLOW_MOCK_PAY` is UNSET in production env (mock-pay must 404).

## 3. Flip the switch (~5 min)
- [ ] Set `PAYMENTS_LIVE=1` (Worker env via wrangler.jsonc or dashboard).
- [ ] Deploy: `npm run build` (webpack) must pass locally first, then push → CI deploy.

## 4. E2E verification (task #32) (~45 min)
> **UPI QR blocker RESOLVED 2026-07-14:** the "Scan with any UPI App" QR spun forever because
> our CSP `connect-src` allowed Paytm only over `https://` — the QR's `wss://` WebSocket
> (`wss://secure.paytmpayments.com/websocket/...`) was blocked (cards/UPI-collect over https
> worked). Fixed by allowlisting `wss://*.paytmpayments.com` in `connect-src` (commit `5e861f2`,
> deployed). QR now renders — verified end-to-end. Full write-up: `PAYTM-UPI-QR-DEBUG.md`.

Real money, smallest amount — the cheapest purchasable lab is the IAM lab at ₹249
(current price authority: `app/lib/payments/pricing.ts`); refund from the dashboard if desired.
- [ ] **Happy path**: sign in with the test account (`himanshujain0901@gmail.com`) → locked paid lab → "Get this lab" → Paytm popup → pay ₹249 (UPI) → sheet shows "Payment confirmed" → "Start the lab" launches. Verify entitlement row (type PAY_PER_LAB, maxLaunches 30, launchCount 1 after launch).
- [ ] **Replay safety**: re-POST `/api/payments/paytm/confirm` with the same orderId → `paid:true` but NO double grant (idempotent CAS; check entitlement version).
- [ ] **Forged success**: POST confirm with a never-paid orderId → `paid:false`.
- [ ] **Cross-user guard**: confirm another user's orderId from the test session → 403.
- [ ] **Callback path**: complete one payment via the redirect flow (or simulate GET) → lands on `/dashboard?paid=1`.
- [ ] **Payments-off regression**: N/A after live, but confirm `/api/payments/mock-pay` → 404 in prod.
- [ ] Watch Worker logs + engine CloudWatch for errors during all of the above.

## 4b. ~~REVERT the temporary IAM ₹99 price~~ — DONE 2026-07-04
- [x] Reverted: both `AWS_LAB_PRICE_OVERRIDE` (shieldsync-website/lib/region.ts) and
      `PER_LAB_OVERRIDE` (labs-platform/app/lib/payments/pricing.ts) are empty again;
      IAM is back at level pricing (₹249). Beginner tier repriced ₹199/$4 on 2026-07-06.

## 5. Post-live config reverts + capacity (~15 min)
- [x] Revert `FREE_POOL_PCT` to ~0.3 — DONE 2026-07-10 (`engine/labinfra.mjs`, engine redeployed).
      At the current 3-account pool: 1 free slot, 2 reserved for paying customers.
- [x] ~~Request **Lambda concurrency increase** on account 750 (currently 10)~~ — DONE (now 1000).
- [ ] Enable the wait-room "skip the line" upsell only if desired (it dead-ended pre-payments).
- [ ] Flip on the payments-gated UI: done-card upsell (F1) + rate-limit upgrade CTA (F3) — both shipped dark, enabled by `PAYMENTS_LIVE`.

## 6. Same-week follow-ups
- [ ] AWS Business support plan ($100/mo) — strengthens the Sept quota resubmission (G2).
- [ ] AWS Activate application — fill spend figures + submit (G3).
- [ ] Cognito client-secret rotation scheduled with owner (H4).
- [ ] GST invoice template ready for B2B deals (J1).

## Rollback
Any step 4 failure → set `PAYMENTS_LIVE=` (unset) + redeploy: checkout returns 503, confirm/callback 404, no orders can be created; existing entitlements unaffected. Investigate with the transcript of the failing call + Worker logs, fix, re-run section 4 from the top.
