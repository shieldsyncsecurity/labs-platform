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
3. **Identity** — email OTP (6-digit, 10-min expiry, 30s resend, lockout after repeats) + the
   consent gate for the session webcam recording (§3: plain recording, recruiter-reviewed, no
   AI). Recording consent is a distinct, itemized tick — not bundled into general ToS.
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
   dot, and a **small live webcam self-view thumbnail with "● Recording" + a live-mic indicator**
   (PearsonVUE pattern — ongoing visible recording notice + deterrent; §3).
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

## 3. Integrity / anti-cheat — the posture (owner-decided 2026-07-12)

**Threat model first.** Deterministic state-grading already defeats answer-copying (no answer
string exists — the candidate must leave a real cloud environment in a correctly-secured final
state; a leaked walkthrough points at different K-of-N-randomized resources; pasting text solves
nothing). The only real gap is **who was at the keyboard**. Residual risk after current controls
(fresh parameterized env · Activity Log · single-active-session · K-of-N seeding):

| Threat | Residual before this section's controls |
|--------|------------------------------------------|
| Impersonation / proxy-taker | **HIGH** — magic link + OTP prove inbox control, not personhood |
| Second human silently assisting | **HIGH** — invisible to any control that only inspects the cloud |
| Scenario pre-knowledge / leak | MEDIUM, rising with volume |
| Cross-candidate collusion (meta-strategy) | MEDIUM |
| AI does ~100% | Not a security gap — AI is *allowed* by design; it's a validity question (measures prompt skill) |

**Scope reset (owner, 2026-07-12): ShieldSync hiring assessments are INDIA-FIRST, will NOT be
sold in the US, and any webcam recording is a PLAIN recording reviewed by a human recruiter —
NO AI analysis of video, ever.** Both facts change the earlier analysis and the prior
"no webcam ever" recommendation is **retracted** as over-indexed on US law and on
algorithmic-bias-in-analysis:
- The **BIPA/ADA/Illinois/EU-AI-Act** exposure is US/EU law → **does not apply** to an India-only
  product. India has no BIPA equivalent.
- The **skin-tone false-positive bias** is a property of *automated facial-recognition/liveness
  algorithms* deciding things. With **no algorithm in the loop — just a video a human watches** —
  that specific automated disparate-impact engine isn't present. (The "no AI decisioning on the
  candidate" principle stays: video is for human identity review + deterrence, never fed to any
  model, never turned into an automated suspicion score.)

**Adopted two-layer posture:**

1. **Default (every candidate): plain webcam + mic recording for human identity review +
   deterrence.** The candidate's webcam AND microphone record during the session; the employer's
   recruiter can view/listen to confirm *this is the person we invited* and as a cheating
   deterrent. **No AI, no automated flagging, no face-matching, no transcription** — a human
   simply reviews if/when they choose. Standard, accepted practice for proctored assessments in
   India. **Audio is the highest-value signal**: video/snapshots catch impersonation-at-camera
   and a visible second person, but only **audio catches the #2 threat — an off-camera human
   coaching by voice, dictation, a phone call, or an earpiece conversation** (otherwise invisible
   to any camera). Video still misses a phone below the desk or a helper on a second silent
   machine — no passive layer is perfect, and buyers should be told so plainly.

2. **In-session fresh rationale — the async "defense," NO separate call.** (Owner, 2026-07-12:
   a mandatory ShieldSync-run "defend your work" call is REJECTED — it defeats the purpose of an
   *automated* screen that exists to save interviewer time and scale, and the employer's real
   interview lands days-to-weeks later, by which point the candidate has genuinely forgotten the
   specifics, making a delayed "explain what you did" both wasteful and unfair.) Instead capture
   the defense **at the moment of doing, while it's fresh**: as the candidate submits (per
   objective or at the end), a quick one-line "why did you do it this way?" — their own
   live-typed reasoning, captured *during* the session, shown to the employer as advisory
   context (never scored — stays LL144/DPDP-clean). An impersonator or paste-only candidate
   can't fluently justify each specific choice in real time. Combined with the **recording**
   (which is itself the async, anytime-reviewable proof that *this person did this work* — no
   call, no memory decay), this covers the who-did-it question without any synchronous step.
3. **Deeper authorship probing folds into the employer's EXISTING interview — not a ShieldSync
   step.** If an employer wants to verify authorship, they do it in the interview round they were
   already going to run, walking in holding the candidate's own recorded session + written
   rationale as reference — they can replay the recording to jog memory and compare "does the
   explanation match what the video shows them doing." This makes their interview better rather
   than adding a step, and keeps ShieldSync's product a pure automated screen.

The layers are **complementary**: the recording is the cheap passive proof across the whole
funnel; the fresh in-session rationale is the zero-friction written defense captured before any
memory decay; deeper checks are the employer's to run in their own interview, better-equipped.

**India-specific requirements to build with the recording (not blockers — just do them right):**
- **DPDP consent + notice.** Recording a candidate's **video and audio** = collecting personal
  data; India's DPDP Act requires clear, itemized, purpose-specific consent BEFORE the first real
  candidate: *what* is recorded (explicitly name **webcam snapshots + continuous microphone
  audio**), *who* sees it (the employer's recruiter), *how long* it's kept, and the
  withdrawal/grievance path. A tick-box gate on the consent screen, not bundled into general ToS.
  (Note: DPDP has no "sensitive data / compelling purpose" tier — that's GDPR/old-2011-rules;
  DPDP's basis here is straightforward consent, which is clean for a recruiter-reviewed recording
  once notice is proper.)
- **Retention — DECIDED (owner, 2026-07-12): recording (video snapshots + audio) auto-deletes
  30 days after the session**, never indefinite. Short by design — video+audio is the most
  sensitive PII we hold and 30 days comfortably covers identity/dispute review. Candidate
  erasure-request path applies (can shorten on request).
- **Capture mechanism — DECIDED (owner delegated, 2026-07-12): snapshot-primary, adaptive.**
  Default = **periodic webcam snapshots** — an identity burst of a few frames at session start
  + a steady cadence (~every 10–15s) thereafter. This is the right call for India-first: it's
  the only option that uploads reliably on flaky broadband / mobile-tethered links, keeps
  storage + DPDP retention cheap, and fully serves the three real purposes (confirm identity,
  deter, give the recruiter reviewable evidence — a recruiter scrubbing snapshots still catches
  a wrong face, an empty chair, a second person, or phone use). **Optional** low-bitrate
  continuous stream is an employer-selectable upgrade for senior/high-value reqs, gated on the
  pre-flight bandwidth check passing; on a weak link it **auto-degrades to snapshot-only**.
  Recording is buffered/retried and **never blocks or interrupts the assessment** (recording
  failure ≠ session failure).
- **Audio — continuous, always on with the snapshots.** Unlike video, low-bitrate audio (~16–32
  kbps) is cheap enough to run **continuously even on weak links**, so it is NOT reduced to
  snapshots — it is the continuous layer that covers the gaps between video frames and is the
  single best catch for off-camera voice coaching. **Privacy caveat (real):** continuous home
  audio is the most intrusive element of the whole design — it captures ambient/background
  speech (family, others in the room), extremely common in Indian home settings. Handle it
  accordingly: honest "mic is recorded" consent (below), retention deleted with the video,
  **human-review-only (no transcription, no AI)**, and a recruiter treats "heard a voice" as a
  *prompt to review the recording*, never as automated proof. Advise the candidate up front to
  sit somewhere quiet and private — better for them and for the signal.
- **Candidate-facing framing + live self-view (PearsonVUE pattern).** State plainly on the
  consent screen; recording is normal for proctored hiring assessments in India and accepted
  when disclosed honestly. In the PiP companion, show a **small live webcam self-view thumbnail
  with a "● Recording" label**, always visible — as PearsonVUE does. It is honest (an ongoing
  visible notice that strengthens DPDP consent beyond the one-time tick), a constant deterrent,
  and reassuring (the candidate can see they're framed and the camera works). A camera-permission
  prompt + framing check is part of the pre-flight capability gate (§5.4 / §6.3).

**Still never built:** AI analysis of the video, automated face-matching/liveness scoring, or any
recording-derived "suspicion score" in the employer report. Video stays a human-reviewed identity
+ deterrence artifact only. AI assistants remain *allowed* during the assessment (realistic job
preview) — and no synchronous ShieldSync-run verification call exists; the recording + the fresh
in-session rationale are the whole authorship story, and any deeper probe is the employer's to run
in their own interview using those artifacts.

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
   retroactively fixed. Retention schedule (three tiers by sensitivity): **webcam+audio
   recording = 30 days** (most sensitive, §3 owner decision); raw Activity Log / session forensic
   data ~90 days then purge (low-sensitivity API log, kept longer for dispute investigation);
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

1. **Integrity posture (owner-decided 2026-07-12):** DEFAULT = plain webcam recording, human
   (recruiter) reviewed, **no AI analysis**; PLUS a **fresh in-session one-line rationale** per
   objective/at-submit (advisory, shown to employer). **NO ShieldSync-run verification call** —
   it defeats the automated screen's purpose and hits candidate memory-decay; deeper authorship
   checks fold into the employer's own interview using the recording + rationale. Recording
   **retention = 30 days post-session** (owner-decided 2026-07-12).
2. **Recording UX + bandwidth — DECIDED:** video = snapshot-primary (identity burst + ~10–15s
   cadence, optional low-bit continuous upgrade gated on bandwidth check, auto-degrade to
   snapshots on weak links); **audio = continuous low-bitrate, always on** (cheap even on weak
   links, and the best catch for off-camera voice coaching); recording failure never fails the
   session; PearsonVUE-style live self-view + "● Recording" + live-mic indicator in the companion.
   Remaining owner to-do (not a decision): DPDP consent copy naming **webcam snapshots + mic
   audio, deleted after 30 days** before the first real candidate.
3. **Desktop-only** — accepted stated limitation, or is a kiosk/center fallback ever in scope
   for candidates without a personal laptop? (Note: webcam recording assumes a device camera —
   another reason desktop/laptop, and a factor for any kiosk fallback.)
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
