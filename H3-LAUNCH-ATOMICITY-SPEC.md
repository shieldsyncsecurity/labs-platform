# H3 — Launch atomicity (per-user TOCTOU) — design spec

> Status: **NOT IMPLEMENTED** — deferred from the 2026-06-22 E2E test/fix pass.
> Reason for deferral: the fix mutates the live account-leasing path and must be
> concurrency-tested before shipping to a production AWS-vending engine. This doc
> is the implementation plan for a future, verified change.

## 1. Problem

`POST /launch` (engine `handler.mjs`) gates a launch with a **read-then-act**
sequence and no atomicity across the steps:

```
handler.mjs (/launch):
  existing = findActiveSession(uid, labSlug)   // reconnect? (H2: now lab-aware)
  used     = launchCount(uid, labSlug, window) // per-level cap
  fc       = freeCapacity()                    // 30% free-pool cap
  leased   = lease(uid, labSlug, minutes)      // atomic PER-ACCOUNT only
```

`lease()` (`labinfra.mjs`) is atomic for a **single account** (conditional
`UpdateItem` on `status = available`), so two requests never grab the *same*
account. But nothing enforces **one in-flight launch per user**. Two near-
simultaneous `/launch` calls for the same user can BOTH:

1. pass `findActiveSession` (neither has created a session row yet),
2. pass `launchCount` / `freeCapacity` (counts haven't changed yet),
3. `lease()` **two different accounts**.

Result: one user holds 2 sessions → exceeds the per-level launch cap and the
free-pool cap, and drains the small (3-account) pool.

All gating reads use `ScanCommand` with eventually-consistent reads
(`labinfra.mjs` `findActiveSession`, `launchCount`, `freeCapacity`), which widens
the race window (a just-written `leasing` row may not be visible yet).

## 2. Impact / severity

- **Severity: Medium.** Real but **bounded** — abuse ≈ pool size; `findActiveSession`
  already makes the *normal* (sequential) reload/relaunch idempotent. It's a
  quota/cost-control weakening, **not** an isolation or auth breach.
- Triggers: double-clicking Launch, the funnel auto-launch firing alongside a
  manual click, a client retry, or two tabs/devices launching at once.

## 3. Invariant to enforce

**One live session per user, total** (not per-lab). With a 3-account pool, a
single user must not hold two accounts. This also reconciles H2: launching a
*different* lab while one is live should be a clear, declined action — not a
silent second lease.

## 4. Proposed design — atomic per-user lock

Add a tiny DynamoDB table **`ShieldSyncLabUserLocks`** (PAY_PER_REQUEST):
- `pk = userId` (S)
- `sessionId` (S), `labSlug` (S), `expiresAt` (S)
- **DynamoDB TTL on a numeric `ttl` attr** = backstop so an orphaned lock self-clears.

### /launch flow (revised)
```
1. reconnect = findActiveSession(uid, labSlug)         // H2 — same-lab live session
   if reconnect: return 200 { resumed:true, ... }

2. ACQUIRE LOCK (atomic):
   PutItem ShieldSyncLabUserLocks { userId, labSlug, ttl }
     ConditionExpression: "attribute_not_exists(userId) OR #ttl < :now"
   if ConditionalCheckFailedException:
     read the lock → return 409 { error:"ALREADY_ACTIVE", labSlug:<other> }
     (UI explains "You already have <lab> running — end it first.")

3. launchCount / freeCapacity checks
   (on reject: RELEASE LOCK, return 429/503 as today)

4. leased = lease(uid, labSlug, minutes)
   (on NO_CAPACITY/throw: RELEASE LOCK, return 503)

5. UpdateItem lock SET sessionId = leased.sessionId   // bind lock to the session
   return 200 { sessionId, ... }
```

### Lock release points (all must delete the user's lock)
- `teardown(sessionId)` — look up userId from the session, `DeleteItem` the lock.
- cold-deploy failure path (`deployLab` error → `markSession 'error'` → teardown) — covered by teardown.
- `reap()` — for each reaped session, release its user's lock.
- `releaseAccount()` (failed-deploy release) — release the lock too.
- **TTL backstop**: set `ttl` = lease window + a grace (e.g. +10 min) so a missed
  release can't permanently wedge a user out.

### Alternative (no new table)
`TransactWriteItems` that, in one transaction, (a) conditional-claims the account
and (b) conditional-puts the per-user lock. Cleaner consistency, but couples the
account scan/selection with the transaction — more code churn in `lease()`. The
separate-lock approach above is simpler to reason about and to release.

## 5. App / UI changes
- `LabPanel` (`lab-panel.tsx`) currently maps non-503/429 → generic `launcherror`.
  Add a `409 ALREADY_ACTIVE` branch: show "You already have **<lab>** running"
  with a link to that lab + an "End it" action. Small, contained.
- `app/api/launch/route.ts`: pass through the 409 with its body.

## 6. Test plan (the reason this was deferred — do NOT skip)
1. **Local/dev harness preferred.** Point the engine at a *test* sessions/accounts
   table (or a dedicated test user) so the prod pool isn't touched.
2. **Concurrency test:** fire N=5 concurrent `POST /launch` for the SAME user/lab;
   assert **exactly one** `leased` result and four `resumed:true`/`409`. Repeat for
   different-lab concurrency (expect one lease + 409s).
3. **Release coverage:** for each release path (End, expiry/reaper, deploy-fail),
   verify the lock row is gone and the user can launch again.
4. **TTL backstop:** insert a stale lock (ttl in the past), confirm a new launch
   acquires it.
5. Only after green: deploy engine (`deploy.ps1`), smoke `/health`, watch
   CloudWatch for any spurious 409s blocking legitimate launches.

## 7. Rollout / risk
- New table is additive (no migration). The lock acquire is one extra conditional
  write on the hot path (~single-digit ms).
- **Risk if wrong:** a release-path miss + TTL too long could wedge a user out of
  launching until TTL. Mitigate with a conservative TTL (lease window + 10 min)
  and thorough release-path coverage (step 3).
- Backward compatible with H2 (reconnect stays lab-aware; the lock makes "different
  lab while one live" an explicit 409 instead of a silent second lease).

## 8. Code touch-points
- `engine/labinfra.mjs`: new `acquireUserLock(userId, labSlug)`,
  `releaseUserLock(userId)`, `bindLockSession(userId, sessionId)`; call releases in
  `teardown`, `reap`, `releaseAccount`.
- `engine/handler.mjs` `/launch`: insert acquire after reconnect, release on every
  early-return reject path, bind after lease.
- `engine/provision.mjs` or a one-off: create `ShieldSyncLabUserLocks` (+ enable TTL).
- `app/app/api/launch/route.ts` + `app/components/lab-panel.tsx`: handle 409.
