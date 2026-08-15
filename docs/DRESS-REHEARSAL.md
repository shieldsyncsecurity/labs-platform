# Pre-launch dress rehearsal

**Purpose:** find what breaks under a real human before ads send strangers into it.
This is a checklist, not a suggestion to "go test things" — each step has an
explicit pass condition. Do it in order; a failure on an early step can mask or
cause failures downstream, so fix and re-run from that step before continuing.

**When:** 26–28 Jul (before the 29 Jul launch, after the 25 Jul scope freeze).
**Devices:** run Parts 1–2 on a phone AND a laptop — most ad traffic is mobile,
most of our own testing has been laptop. Use a private/incognito window so you
get the real first-time experience, not a cached session.

---

## Part 1 — B2C free-lab funnel (the ad landing path)

The catalogue has **2 free labs live**: `s3-misconfiguration-audit` and
`bedrock-prompt-injection`. Run both — the Bedrock lab has never been owner-tested
end-to-end and is exactly what ads will point strangers at.

1. Open `shieldsyncsecurity.com` in a fresh incognito window (not `labs.` directly
   — you want the real funnel entry).
   - [ ] **Pass:** page loads, no console errors, currency shows correctly for
     your location (INR).
2. Click through to `/labs-wizard`, pick the free track, land on a lab.
   - [ ] **Pass:** the handoff to `labs.shieldsyncsecurity.com` is seamless — no
     broken link, no second sign-up prompt if you're about to sign in once.
3. Sign up fresh (Google or LinkedIn — use an account you don't normally use for
   this, so you see the real first-run state, not an account with history).
   - [ ] **Pass:** consent/cookie banner appears once, dismisses cleanly.
4. Launch **`s3-misconfiguration-audit`**.
   - [ ] **Pass:** federated console URL opens, you land inside a real AWS
     console, the seeded misconfiguration is visible (public bucket, over-broad
     IAM user).
   - [ ] **Time it.** Note how long "Launch" takes to hand you a console. This is
     your baseline before ad-driven concurrency.
5. Fix **three** of the six planted flaws only (leave the rest broken) and click
   "Check my work".
   - [ ] **Pass:** exactly 3 objectives show passed, the rest show "todo" or
     unknown — not silently all-pass or all-fail.
6. Fix the rest, re-check, reach 6/6.
   - [ ] **Pass:** completion state triggers, certificate becomes available.
7. Download the certificate (PDF and PNG), then open `/verify/[id]` **in a
   different, fully signed-out browser**.
   - [ ] **Pass:** the credential is publicly verifiable with no login.
8. Repeat steps 4–7 for **`bedrock-prompt-injection`** end to end.
   - [ ] **Pass:** same shape — launch, seeded flaw visible, grading reflects
     partial and full completion correctly, certificate issues.
   - This lab has 3 objectives and touches Bedrock/Nova-Lite — watch specifically
     for a quota error or a slow/failed grade call.

**If anything in Part 1 fails:** stop, fix, restart Part 1 from step 1. This is
the path every ad dollar lands on.

---

## Part 2 — Real ₹249 purchase (B2C paid lab)

`iam-privilege-escalation` is the one paid, ready lab. `PAYMENTS_LIVE=1` and
`PAYTM_ENV=production` are already set — this is a **real transaction with real
money**, not a sandbox. Use your own card.

1. From a signed-in account (can reuse Part 1's), open the IAM lab, hit "Launch"
   or "Buy" and go through Paytm checkout.
   - [ ] **Pass:** checkout opens, amount shown is exactly ₹249, no console
     errors mid-flow.
2. Complete payment.
   - [ ] **Pass:** redirected back to ShieldSync (not stranded on Paytm), lab
     unlocks **within seconds**, not minutes.
3. Check `/admin/orgs` — wait, this is B2C — check the DynamoDB `LabOrders` table
   or the admin panel that surfaces it.
   - [ ] **Pass:** the order is recorded, entitlement granted (3 launches / 7-day
     window per the v2 entitlement model).
4. Actually run the lab once (don't just verify checkout).
   - [ ] **Pass:** same grading/certificate path as Part 1.
5. Note the transaction in your own records — this is real revenue, log it like
   any other sale.

**If checkout fails:** do not soft-launch anyway. A broken checkout on launch day
is the single worst failure mode — ad spend drives traffic straight into it.

---

## Part 3 — B2B candidate run, with recording (the Zensar-facing path)

This exercises the exact flow you'll demo live, and it's the one that just got
21 defects fixed by adversarial review — the first real human run since. Use two
people if you can (you + one other), or one person across two browser profiles /
devices to simulate employer + candidate.

1. **As staff:** create a test org via `/admin/orgs/new`, note the orgId.
2. **As staff:** grant yourself a portal seat via the new "Portal seats" panel on
   the org page (Cognito sub → this org). **This is a genuinely new step** — as
   of this week, creating the Cognito user alone no longer grants access; the
   seat must be explicitly bound.
   - [ ] **Pass:** you can sign in to `/portal` for this org afterward, and
     **cannot** before the seat is granted (verify the fail-closed direction too).
3. **As employer:** create an assessment, invite a test candidate email (use a
   real inbox you can check — Resend delivery is being verified here too).
   - [ ] **Pass:** invite email arrives within ~1 minute, link works.
4. **As candidate:** open the invite link, consent, verify OTP, book/start a slot.
   - [ ] **Pass:** OTP email arrives promptly, consent copy is accurate,
     scheduling works.
5. **Start the lab.** When the session-recording consent screen appears, **grant
   camera + mic** — this is the step that has never been tested with a real
   camera.
   - [ ] **Pass:** permission prompt is clear, consent copy is accurate (DPDP
     language), recording indicator shows "Recording" honestly (not stuck on
     "Recording starting…").
   - [ ] **Pass:** work in the console for a few minutes, **switch tabs once**
     (should NOT trigger early auto-submit — this was a fixed bug, confirm it
     stays fixed), **reload the page once** (should start a new capture epoch,
     not overwrite the identity shot — also a fixed bug).
   - [ ] **Pass:** at some point, **revoke camera permission** from the browser's
     own UI mid-session, confirm the "paused" state shows honestly and the
     re-enable button actually works.
6. Complete the objectives (partial is fine — you're testing the mechanism, not
   grading it perfectly), write a short reflection, submit.
   - [ ] **Pass:** submit succeeds, teardown happens, no zombie camera light
     after submit.
7. **As employer:** open the candidate report.
   - [ ] **Pass:** competency profile renders (4 dimensions), time-on-task shows,
     the recording section shows the identity shot + snapshot filmstrip +
     playable audio — and if you reloaded in step 5, **the re-entry shows as a
     second identity photo, not a silently overwritten first one.**
   - [ ] **Pass:** click a snapshot thumbnail — lightbox opens, Escape closes it,
     works via keyboard (Tab + Enter), not just mouse.
8. **As staff:** open `/admin/forensics` for this candidate, confirm the work
   timeline (CloudTrail) and debrief questions rendered.
   - [ ] **Pass:** these are new this week — first time seeing them against a
     real session, not synthetic data.
9. **As staff:** trigger PII erasure for the test candidate via the erase flow.
   - [ ] **Pass:** the response reports `recDeleted` and `recFailed:0` — if
     `recFailed` is nonzero, the erasure did NOT fully complete and media
     survived; that's a stop-ship, not a log-and-move-on.

**If session recording never worked with a real camera before, budget the most
time here.** This is genuinely first contact between the code and physical
hardware.

---

## Part 4 — Infrastructure sanity (quick, do alongside Parts 1–3)

- [ ] Cloudflare Workers is on **Paid** ($5/mo) before this rehearsal — Free
  tier's 10ms CPU cap can itself cause failures indistinguishable from real bugs.
- [ ] Check CloudWatch alarms (`ShieldSyncEnterpriseEngine-Errors`,
  `-Throttles`, `-EmailQuotaBlocked`) are quiet during the run — a false quiet
  during a real run tells you the alarms work; an alert tells you something
  the rehearsal itself broke.
- [ ] Confirm the `_dmarc` record change from earlier this week actually landed
  (`nslookup -type=TXT _dmarc.shieldsyncsecurity.com amalia.ns.cloudflare.com`).

---

## What to do with failures

Log every failure here (or tell me and I'll log it), even small ones — a launch
week bug list is worth more than a clean-feeling memory. For each:
**what you did → what happened → what you expected.** I'll triage and fix before
29 Jul; anything that can't be fixed in time gets a go/no-go call, not a silent
ship.
