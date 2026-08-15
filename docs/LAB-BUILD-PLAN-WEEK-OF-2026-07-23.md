# Lab build plan — week of 2026-07-23

Grounded in `ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md` (the v2 content plan, already
owner-designed and hardened by 3 adversarial reviews). **This document does not
re-plan the content** — it decides *which* level ships next, what is genuinely
buildable in a week, and what it collides with.

---

## 1. The decision: AWS L2, not Azure L2

The content plan records **"SEQUENCING DECIDED BY OWNER 2026-07-12: AZURE-FIRST"**,
on the rationale that the AWS account pool is hard-capped at 3 = the throughput
ceiling, while Azure has a $5k credit and no vending wall.

That rationale is still true **at batch-sale volume**. It is not true *this week*,
and two things have changed since it was taken:

| | AWS L2 | Azure L2 (Phase 1) |
|---|---|---|
| Content spec | **complete** (§4, 5 objectives, canary designed) | must be written (A3) |
| Platform | **live in production** | driver ~built; identity model half-built |
| Owner gates | **none** | **A0 dedicated Entra tenant** (may need a paid P1 seat) + **Graph `Application.ReadWrite.OwnedBy` admin consent** |
| Days those gates have been open | — | 11, unmoved |
| Throughput needed for a Zensar demo | 1 session | 1 session |

The 3-account cap bites at **6–8 assessments/day** (the plan's own number). The
first demo, the first pilot and the first paid engagement are all far below it.
Choosing the blocked track to avoid a ceiling we are nowhere near costs a week.

**Recommendation: build AWS L2 now; Azure L2 becomes Phase 2 the day A0 + Graph
consent land.** Nothing in the Azure work is wasted — §9b says the L1–L5
architecture, scoring, anti-leakage and compliance sections port unchanged, and the
taxonomy maps 1:1.

> If you'd rather hold the Azure-first line, the *only* thing that unblocks it is
> you: create the labs Entra tenant and grant the Graph consent. Say the word and
> I'll switch — but the week can't start until those land.

## 2. What Phase 1 actually gates on — and what's already done

The plan gates L2 on `E0–E4, E10, E11`. Reassessed against the current codebase:

| Δ | Status | Verdict for L2 |
|---|--------|----------------|
| **E0** learnerPolicy char-budget gate | **mostly done** — `build-lab-content.mjs` already fails the build over ~1000 chars bare | extend to per-level, ~2 h |
| **E1** weighted sub-checks + unknown-quarantine | **partly done** — 4-competency scoring, `verifiedStats`, and the unknown-never-counts-as-pass rule all shipped this week | ship L2 at equal weights; weighting later |
| **E2** truth registry (CFN Outputs → DynamoDB; zero hardcoded names) | **not built** — graders still hardcode `sslab-data-${accountId}` | **required**, ~1.5 d |
| **E3** Access Analyzer + reference envelopes | not built | **not needed for L2** — obj 3 is graded by policy-document analysis, which the grader already does. Defer to L3/L4 |
| **E4** canary invoke (retry/backoff, nonce, CodeSha256 pin) | not built | **required** for obj 5, ~1.5 d |
| **E5** variants | **partly done** — per-session misconfig variance shipped this week (flag-gated) | extend to K-of-N later |
| **E10** aws-nuke default-VPC preservation | not built | **not needed for L2** (no SG objectives). Blocks L1 obj 3 only |
| **E11** variant self-test harness | not built | **required** — see below, ~1 d |

**E11 is the highest-value item on this list and should be built first.** Last
week's adversarial review caught a variant that would have failed ~20% of launches
(a pre-planted encryption Deny blocked the seeder's own write). A harness that
deploys → grades seeded-fail → scripted-fix → grades pass → nukes would have caught
that in minutes without a review. Every subsequent level depends on it.

## 3. Honest capacity: this collides with launch

Scope freeze is **25 Jul**, launch **29 Jul**. The Phase-1 gate list is ~1 S + 4 M
of engine work *plus* the scenario content — that is more than a week on its own,
and it wants the same 3 sandbox accounts the launch funnel needs.

Two of the ship gates are also **not mine to close**: the reference-solver must
pass 100% under the real learnerPolicy in ≤40 min, and §16 requires a pilot tester
*at that level* — explicitly not the owner.

### Recommended sequence

| When | Focus | Owner | Me |
|------|-------|-------|-----|
| **24–25 Jul** | Launch-critical only | Workers Paid · approve ads · DMARC record | dress-rehearsal script · ad drafts |
| **26–28 Jul** | Dress rehearsal + fixes | sit the full run, pay the ₹249, one camera run | fix whatever it surfaces |
| **29 Jul** | **LAUNCH** — monitor only, no new code | watch spend + funnel | on-call |
| **30–31 Jul** | L2 groundwork | — | **E11 harness**, then **E2 truth registry** |
| **1–4 Aug** | L2 build | reference-solve it yourself (≤40 min) | **E4 canary**, L2 scenario + grader |
| **~5 Aug** | L2 ship gate | find one L2-level pilot tester | variant self-tests green → `ready:true` |

If you want lab work to start *this* week instead, the trade is explicit: the
launch slips, or it ships without the dress rehearsal. I'd take neither.

## 4. What I will NOT do

- **Touch the live S3 lab.** L2 is a *new* scenario (`aws-pipeline-hardening-l2`),
  additive: new template, new grader function, new catalogue entry. The launch path
  stays frozen.
- **Mark anything `ready:true` without its gates.** Per §7, readiness is per
  *variant*, proven by the harness — not by "it compiled".
- **Build L1/L3/L4/L5 content this week.** The plan's order is L2 → L3 → L1 → L4 → L5,
  and L1 obj 3 is blocked on E10 anyway.

## 5. Open owner decisions that gate content design (§10)

Still unanswered, and they shape the L2 report copy:

1. L5 rename/positioning ("Security Lead — technical prioritization screen")
2. Level pricing — one line on the rate card, needed before the first demo
3. Objective-list visibility to candidates pre-start (leakage vs candidate experience)
