# Paytm Go-Live Runbook — execute the day merchant approval lands

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
- [ ] In the Paytm dashboard, set the callback URL to `https://labs.shieldsyncsecurity.com/api/payments/paytm/callback`.
- [ ] Housekeeping: if a `RAZORPAY_WEBHOOK_SECRET` Worker secret exists in the Cloudflare dashboard, delete it (code no longer reads it).

## 2. Pre-live security batch (audit #10 / #2 / #8 residuals) (~30 min)
- [ ] Re-verify paid-content gating (#10): anonymous + free-tier user cannot fetch a paid lab's walkthrough from `/api/lab-content` (expect 401/403).
- [ ] Re-verify signed engine identity token (#2) is enforced on per-session routes (tamper `x-user-id` → 401).
- [ ] Re-verify admin-access record (#8): `ADMIN_USER_IDS` contains only your Cognito sub.
- [ ] `ALLOW_MOCK_PAY` is UNSET in production env (mock-pay must 404).

## 3. Flip the switch (~5 min)
- [ ] Set `PAYMENTS_LIVE=1` (Worker env via wrangler.jsonc or dashboard).
- [ ] Deploy: `npm run build` (webpack) must pass locally first, then push → CI deploy.

## 4. E2E verification (task #32) (~45 min)
Real money, smallest amount — use the ₹99 per-lab plan, then refund from the dashboard if desired.
- [ ] **Happy path**: sign in with the test account (`himanshujain0901@gmail.com`) → locked paid lab → "Get this lab" → Paytm popup → pay ₹99 (UPI) → sheet shows "Payment confirmed" → "Start the lab" launches. Verify entitlement row (type PAY_PER_LAB, maxLaunches 30, launchCount 1 after launch).
- [ ] **Replay safety**: re-POST `/api/payments/paytm/confirm` with the same orderId → `paid:true` but NO double grant (idempotent CAS; check entitlement version).
- [ ] **Forged success**: POST confirm with a never-paid orderId → `paid:false`.
- [ ] **Cross-user guard**: confirm another user's orderId from the test session → 403.
- [ ] **Callback path**: complete one payment via the redirect flow (or simulate GET) → lands on `/dashboard?paid=1`.
- [ ] **Payments-off regression**: N/A after live, but confirm `/api/payments/mock-pay` → 404 in prod.
- [ ] Watch Worker logs + engine CloudWatch for errors during all of the above.

## 5. Post-live config reverts + capacity (~15 min)
- [ ] Revert `FREE_POOL_PCT` to ~0.3 (free tier stops hogging the pool now that paid is live).
- [ ] Request **Lambda concurrency increase** on account 750 (currently 10) via Service Quotas.
- [ ] Enable the wait-room "skip the line" upsell only if desired (it dead-ended pre-payments).
- [ ] Flip on the payments-gated UI: done-card upsell (F1) + rate-limit upgrade CTA (F3) — both shipped dark, enabled by `PAYMENTS_LIVE`.

## 6. Same-week follow-ups
- [ ] AWS Business support plan ($100/mo) — strengthens the Sept quota resubmission (G2).
- [ ] AWS Activate application — fill spend figures + submit (G3).
- [ ] Cognito client-secret rotation scheduled with owner (H4).
- [ ] GST invoice template ready for B2B deals (J1).

## Rollback
Any step 4 failure → set `PAYMENTS_LIVE=` (unset) + redeploy: checkout returns 503, confirm/callback 404, no orders can be created; existing entitlements unaffected. Investigate with the transcript of the failing call + Worker logs, fix, re-run section 4 from the top.
