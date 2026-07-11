# ShieldSync Enterprise — Assessment Design (interface · per-grade complexity · integrity · pre-build angles)

**Status: DRAFT v1 — 2026-07-12. Owner review pending. Nothing built. Azure-first.**

Companion to `ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md` (the what/why of the L1–L5 scenarios).
This doc is the *experience + operating* design produced by a 4-lane multi-agent sweep
(interface, per-grade complexity, integrity/anti-cheat, pre-build angles) plus adversarial
critique of the two heaviest lanes (a psychometrics/hiring-manager pass on complexity, a
privacy-lawyer + candidate-experience pass on integrity) plus a completeness sweep. Where the
critique changed a recommendation, the change is applied and noted **[critic-fixed]**.

This is A0-independent — it can all be decided/designed while the dedicated labs Entra tenant
(gate A0) is pending.

---

## 1. The candidate interface, end to end (Azure-first)

**Model: two working surfaces, never three.** The real Azure Portal opens in a **new tab**
(can't be iframed — provider console sends `X-Frame-Options: DENY`) and a **Document
Picture-in-Picture companion** (~340×480, draggable, OS-level always-on-top, survives alt-tab)
carries timer + checklist + test-app + submit. The instant the candidate clicks Start, the
original ShieldSync tab goes **inert** ("your assessment is running in the floating window — you
can close this tab"), collapsing three surfaces to two. The word "canary" (and all internals)
never appears in candidate copy.

**Journey:**
1. **Invite email** — "X invited you to a hands-on security assessment — 60 min, on your
   schedule." Plain-language level name, "real cloud environment, not a quiz," single-use magic
   link (7-day expiry, self-serve resend).
2. **Landing / consent** — role+level badge, employer logo, "what this is / isn't," a 4-item
   must-check gate (activity recorded for scoring integrity · AI assistants allowed, a second
   human is not · privacy/retention link · environment fully isolated from any real company
   system) + a non-destructive "Not right now" exit.
3. **Identity** — email OTP only (6-digit, 10-min expiry, 30s resend, lockout after repeats).
   No document/webcam upload (see §3).
4. **Pre-brief** — single scroll (not a wizard): Environment · Timer ("60 min, cannot be
   paused, always visible in the floating window") · Objectives ("up to 5, partial credit — 3
   of 5 beats 0 of 5") · Rules · What-happens-after. **Rehearses the tab→companion handoff with
   a screenshot/gif before Start** (defuses the #1 rage-quit moment). "Block ~75 minutes total."
5. **Slot booking** — 7–14 day grid in the candidate's **local timezone** (shows recruiter TZ
   too when it differs — cheapest fix for the #1 no-show cause), "Start now" gated by live pool
   capacity, .ics + 24h/1h reminders, self-serve reschedule to 1h before.
6. **Pre-start lobby** — "provisioning your environment" (30–90s), pop-up-blocker check,
   irreversible-Start confirmation modal. **Provisioning failure retries without burning the
   slot.**
7. **The room** — companion contents: countdown (amber@10m / red@2m / overlay@30s), expandable
   objective checklist with optional hints + a cosmetic "mark attempted" toggle, **"Test the
   app"** (on-demand non-scored canary, 1/2min — the free confidence signal that defuses
   fear-of-breaking-the-sandbox, the #2 rage-quit moment), "Reopen console" (relaunch without
   re-provision), Submit (distinct color, confirm modal), minimize-to-pill, connection-status
   dot.
8. **Failure/reconnect states** — popup blocked → banner, timer runs server-side; console
   closed → one-click relaunch; network drop/sleep → reconnect within a **5-min grace** to a
   **server-authoritative timer** (never trust local clock), beyond grace → auto-submit at last
   state; timer-0 → **exactly-once idempotent server-side auto-submit** with an immediate "your
   work as of 60:00 has been recorded" confirmation (defuses timer-0 ambiguity, the #3 rage-quit
   moment); provider outage → "your progress and timer are unaffected" + support escalation.
9. **Reflection** — 2–3 short prompts (~90s, skippable), captured verbatim, advisory only. A
   short untimed grace window right after a timer-0 auto-submit so a last-second candidate still
   gets to explain.
10. **Submitted/done** — shows objectives *attempted*, never a score.

**Azure-vs-AWS deltas:** Entra sign-in into the labs tenant vs Cognito; "Azure Portal + Cloud
Shell" vs "AWS Console + CloudShell" copy; a **2–3 min non-scored Portal orientation primer** at
session start (see §4.2 — this is a validity control, not a nicety).

## 2. Employer interface

- **Create assessment + level-picker** — a short JD-mapping picker returns a **plain-language
  grade name + one-liner** ("Implement Controls — mid-level engineer"), L1–L5 shown only as a
  secondary label. Cloud track (Azure/AWS) chosen by the employer to match the req.
- **Invite + monitor** — status + elapsed time only, **no proctoring/telemetry leakage** into
  the employer view.
- **Reports** — two layers: a **30-second comparison grid** (check/partial/✗ icons + one-line
  templated narratives, no numeric score) and a **per-candidate report** (plain-language
  objective outcomes, verbatim reflection visually separated as grey/advisory, an
  app-still-works reassurance line). **No numeric score, no hire/no-hire, anywhere.**

## 3. Integrity / anti-cheat — the honest posture **[critic-fixed]**

**Threat model first.** Deterministic state-grading already defeats answer-copying (no answer
string exists, only a correct end-state), but proves nothing about *who was at the keyboard*.
Residual risk after current controls (fresh parameterized env · Activity Log · single-active-
session · K-of-N seeding):

| Threat | Residual today |
|--------|----------------|
| Impersonation / proxy-taker | **HIGH** — magic link + OTP prove inbox control, not personhood |
| Second human silently assisting | **HIGH** — invisible to any control that only inspects the cloud |
| Scenario pre-knowledge / leak | MEDIUM, rising with volume |
| Cross-candidate collusion (meta-strategy) | MEDIUM |
| AI does ~100% | Not a security gap — AI is *allowed* by design; it's a validity question (measures prompt skill) |

**Webcam / facial proctoring: do NOT build it, ever — not even as a paid tier.** It catches
presence/multi-face but misses audio coaching and off-frame help, has documented skin-tone /
lighting false-positive bias (a live discrimination risk in an India-first pool), reintroduces
exactly the automated adverse-inference the advisory-only design avoids (EU-AI-Act/LL144), and
is the precise fact pattern behind the BIPA/ADA suits against HireVue. Disproportionate for a
60-min screen.

**[critic-fixed] The earlier draft's "default = one-time ID/liveness check + passive telemetry"
is rejected.** The privacy-lawyer critique caught three real problems: (1) **liveness IS
biometric** — it inherits the same skin-tone bias and, worse, *gates the candidate before they
start*, creating silent adverse impact; (2) the **passive typing/paste telemetry is theater with
a downside** — it manufactures a "suspicion" signal for pasting, which is *sanctioned* behavior
since AI is allowed, and any such signal reaching the employer report is the profiling the
architecture exists to avoid; (3) the original **DPDP legal basis was factually wrong** (DPDP
2023 has no "sensitive data / compelling legitimate purpose" tier — that's GDPR Art 9 / the old
2011 SPDI rules; DPDP's only bases are consent or the §7 legitimate-uses list, and the
employment legitimate-use almost certainly does **not** cover a pre-hire *candidate*, so
**consent is the only lawful basis** — and consent conditioned on biometric capture to be
assessed for a job is likely not "freely given," failing the DPDP "free" standard and GDPR's
power-imbalance guidance).

**Adopted posture — proportionality flipped to match a screening:**
- **Default (every candidate): zero biometric friction.** Magic link + OTP + fresh isolated env
  + Activity Log + single-active-session + K-of-N seeding. Accept bounded residual impersonation
  risk *at the screening stage* — screening's job is to filter cheaply.
- **Assurance where it matters: the "defend your work" call.** A short (5–10 min) live
  follow-up, auto-scripted from the candidate's *actual submitted state* ("walk me through why
  you scoped this NSG rule to /24 not /32"). This single control defeats impersonation, silent
  assistance, **and** AI-as-conduit at once, with zero recording/consent infrastructure — apply
  it to candidates who **advance**, and by default to **L4/L5**. Must be **structured** (fixed
  rubric generated from submitted state, calibrated reviewers, logged rationale) so it doesn't
  become an unstructured bias vector.
- **Any integrity signal stays internal-only**, never in the employer-verbatim report, never
  rank-affecting, with a human-review gate and a candidate access/correction path (DPDP §11–13
  rights).
- **Trust differentiator:** publicly state "we deliberately do not use webcam/facial
  proctoring, and here's why" — a credible position against HireVue-class incumbents in the 2026
  enforcement climate.
- **On US/EU expansion:** the no-facial-analysis posture is a permanent product principle, not a
  market-specific choice.

## 4. Per-grade complexity — the Azure L1–L5 scenarios

Uniform grading spine: **Submit → 90–120s settle window (RBAC/config propagation) → warm the
canary → read final state per objective → run behavioral probes → capture reflection.** Never
grade off the Azure Policy *compliance* engine (15–30 min lag); grade authored definitions +
synchronous deny drift-probes. Every seeded finding carries a hidden `ss-finding-id` tag
(invisible to the candidate's scoped Reader); candidates express judgment by writing prescribed
tags (`ss-finding`, `ss-severity`, `ss-priority`, `ss-risk-basis`) read back via Resource Graph.

| Level | Scenario (recruiter one-liner) | Scored obj. | Level-critical | Est. min |
|-------|-------------------------------|-------------|----------------|----------|
| **L1 Analyst** | Triage a review queue: flag misconfigs, rate severity, don't fix | 5 | public-storage detect · open-mgmt-port NSG · don't-flag-decoy (restraint) | ~38 |
| **L2 Engineer** | Lock a live storage+app at the root without downtime | 4 | storage lockdown · secret→Key Vault · least-priv role (behavioral probe) | ~54 |
| **L3 Senior** | Contain a leaked key; only one is named — find them all | 4 | unprompted blast-radius sweep · close the leak path | ~53 |
| **L4 Architect** | Prevent recurrence; leave the legit CDN-origin public | 4 | deny-policy drift-probe · correctly-scoped exemption | ~51 |
| **L5 Lead** | 12 findings, 60 min, can't fix all — prioritize | 2 + 1 adv. | blast-radius-weighted prioritization tagging | ~56 |

**How difficulty escalates without adding objectives:** the *kind of cognition* rises as the
count falls — **detect (L1) → implement (L2) → diagnose ambiguity (L3) → design prevention (L4)
→ allocate under scarcity (L5)**. Each level would false-pass a candidate one tier down *doing
more of the tier-down task* — which is exactly why the level-critical objectives are the
tier-defining ones, unreachable by lower-band mechanics.

**L4 vs L5 kept distinct** (both can leave similar Azure state): L4 grades a **specification**
(does the guardrail synchronously deny + is exactly the CDN account exempt), L5 grades a
**ranking** (candidate's `ss-priority` tags scored by top-set recall + false-P0 precision +
band-level Kendall's τ against an authored `finding-id → blast-radius-weight` map with
deliberately **gapped weight tiers**). L4 never computes a ranking; L5 never grades guardrail
correctness. Same drive, orthogonal graders.

**The no-Access-Analyzer gap** bites only where a candidate **authors an RBAC role** (L2 O3):
never parse the role for least-privilege — run a **behavioral allow-set/deny-set permissions
harness** against the granted principal (formulation-agnostic, catches over-broad wildcards a
string-diff would pass). Authored *policy* least-privilege (L4) = policy-document analysis of
`policyRule` **plus** a synchronous deny drift-probe (a denied control-plane PUT returns 403
immediately — no compliance scan).

**Biggest validity risk per level → mitigation:**
- **L1** subjective severity false-fails → post the rubric in-lab, grade *detection* primary +
  severity as a ±1-band sub-check, fixed tag vocabulary, unambiguously-benign decoy.
- **L2** mechanism bias (Key Vault access-policy vs RBAC) + propagation lag → probe the
  *effect* not the mechanism, only after settle window; close the plaintext-left-beside-KV-ref
  false-pass with an explicit "no raw secret remains" scan.
- **L3** sweep string-match misses encoded secrets / out-of-scope instances → seed all N inside
  the candidate's Reader scope, match raw + base64, prefer behavioral invariants.
- **L4** compliance-lag false-fails everyone → never read compliance; drift-probe + document
  analysis; make the CDN exception deterministically identifiable (`purpose=cdn-origin` + real
  CDN profile) so it's found, not guessed.
- **L5** defensible orderings diverge from ground truth → gapped weight tiers, grade band
  membership with tolerance, weight top-set recall highest, route reflection to a human to
  rescue sound outliers; kill "tag everything P0" with the precision term.

*(Full objective-by-objective spec with exact Resource Graph queries and probe allow/deny sets
lives in the design-sweep source; port into each level's `lab.json` at build.)*

## 5. Pre-build decisions (the "what else before A0" sweep)

**MUST DECIDE NOW** (retrofitting after real candidates + real money is far costlier):

1. **Scoring stays strictly criteria-referenced** — per-objective pass/fail/partial, **no
   composite 0–100, no percentile language** until ≥100 completed sessions *per grade+track*.
   This is the first thing an HRBP interrogates, and it shapes both the rank logic and the
   report UI. Define the "effectively tied" band now (rank by objectives-fully-passed, partial
   credit as tiebreaker within tolerance, ties labeled "comparable"). A one-page "how scoring
   works" methodology artifact must exist before the first sale; exact numeric bars calibrate on
   pilot data.
2. **Azure/AWS familiarity is construct-irrelevant variance** — employer picks the track to
   match the req (framed job-relevant, never a candidate handicap); the **2–3 min non-scored
   Portal orientation primer** isolates "configured correctly" from "found the blade"; AWS and
   Azure results for one candidate are never averaged/interchanged.
3. **DPDP consent + retention + erasure copy ships before the first real candidate** — PII
   (email, OTP, Activity Log, verbatim reflection) flows at first use and a weak notice can't be
   retroactively fixed. Retention schedule: raw forensic/session data ~90 days then purge;
   graded report + reflection for the 6-month validity window then anonymize/delete. Itemized,
   purpose-specific notice (not bundled ToS); build an erasure-request path (manual/email at
   launch is fine).
4. **Accessibility** — companion + report to WCAG 2.1 AA (keyboard nav, icon+text not
   color-alone — brand amber already avoids red/green); an **accommodation-request field** in
   the booking/consent step now (fulfillment can be manual), with **extended time as a native
   timer parameter**; plain idiom-free English v1; a **pre-flight browser/bandwidth capability
   check** (Chromium desktop, Document-PiP present, pop-ups allowed, min screen, portal
   reachable) that blocks *before* the timer with a docked in-tab companion **fallback** when
   PiP is unavailable; **desktop-only** session (stated equity limitation for India
   laptop-access — decide accepted vs future kiosk fallback).
5. **Scheduling/refund policy** (money is live via Paytm, so a vacuum = disputes) — candidate
   no-show = one free reschedule then forfeit, employer self-serve re-invite; mid-session
   reconnect via same link before timer-0, no penalty (work lives in the real RG, not the
   browser); **our-side failure = automatic credit, no dispute** (server-side session-validity
   check), stated publicly as an SLA.
6. **Result validity/reuse** — 6-month window per candidate+grade+track; no retake within window
   for the same employer+req; a different employer always gets a fresh session; same employer
   with a matching later req can view the existing report with an "originally taken for [req] on
   [date]" banner rather than a forced retake.

**SAFE TO DEFER:** full localization; SOC 2/ISO for ShieldSync itself (documented-controls
trust messaging until then — a "Security & Trust" page stating the *true* built controls beats
implying a cert that doesn't exist); consent-manager registration / DPO; refined SLA tiers.

**Named blocker surfaced again:** **SES production access is still denied** → real (non-sandbox)
candidate magic-link email can't send at volume, which gates the first GCC pilot batch
regardless of any design here. This sits above the design work in priority.

## 6. Completeness gaps the four lanes collectively missed (from the meta-critic)

1. **Environment provisioning readiness + capacity + failure handling** — Azure control-plane
   setup is minutes-long and eventually-consistent, and subscription quotas cap concurrency
   (the AWS pool already hit a 3-account cap). **Pre-provision from a warm pool ahead of the
   booked slot; gate Start behind a green "environment ready" health check; on failure hold the
   clock at 60:00 with one-click reschedule** so setup latency never eats candidate time. This
   reshapes the booking→session architecture (provision ahead of slot, not at Start).
2. **Grading validity for multiple valid solutions + read-at-submit consistency** — defensive
   hardening usually has several equally-correct Azure paths (NSG vs Private Endpoint vs Policy).
   **Author each objective as an outcome check with an explicit equivalence class of acceptable
   end-states** (not path-matching), and **re-read after a fixed settle window with retries
   before teardown**, persisting the read as dispute evidence. This is load-bearing for the
   whole AI-Act/LL144-avoidance posture — rank defensibility rests on the grader being
   demonstrably fair.
3. **Client pre-flight capability gate + non-PiP fallback** — Document-PiP is Chromium-desktop
   only; the companion collapses silently on Firefox/Safari/mobile or a blocked pop-up.
   Capability check before booking is confirmed + a **docked in-tab companion fallback**.
   (Folded into decision 5.4.)
4. **Accessibility accommodations for the timed assessment itself** — a hard 60-min timed
   pre-hire test + always-on-top widget triggers ADA (US) and the RPwD Act (India) duty to
   accommodate. **Time-extension as a first-class timer parameter, accommodation request at
   consent, WCAG-conformant keyboard-operable companion.** (Folded into decision 5.4.)

## 7. Owner decisions this design surfaces (adds to plan §10)

1. **Integrity posture** — confirm: default = no biometric friction; assurance = structured
   "defend your work" call for advancers + all L4/L5; webcam never. **Who runs the call** —
   ShieldSync-side reviewer (sellable paid tier) or the employer's own interviewer (zero
   ShieldSync labor, variable quality)?
2. **Publicly state the no-facial-proctoring position** as a trust differentiator? (recommend
   yes)
3. **Desktop-only** — accepted stated limitation, or is a kiosk/center fallback ever in scope
   for candidates without a personal laptop?
4. **Cloud track selection** — employer picks per req (recommended), or ShieldSync infers from a
   candidate intake question?
5. **Validity window / retake numbers** — confirm 6 months + the reuse rules in 5.6.
6. **ShieldSync's own SOC 2/ISO 27001** — pursue now (leveraging the Appstean engagement
   experience) or stay documented-controls-only through the first several deals?

---
*Sources: 2026-07-12 design sweep (4 design lanes + 2 adversarial critiques + completeness
critic; ~450k tokens). Legal facts (DPDP §7 legitimate-uses, GDPR Art 9, BIPA/HireVue,
Illinois HB3773, EU AI Act high-risk employment) from the integrity lane + its lawyer critique.
Azure grading mechanics (ARG/ARM reads, behavioral permission probes, deny drift-probe) from the
complexity lane, consistent with plan §9b.*
