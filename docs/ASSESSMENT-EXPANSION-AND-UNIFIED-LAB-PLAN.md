# Assessment format expansion + unified lab environment — plan

Written 2026-08-15. Answers three things asked together: (1) what other assessment
*types* make sense for B2B technical security hiring beyond "find and fix a cloud
misconfig", (2) how to give candidates one integrated, unified lab environment
across formats instead of bespoke plumbing per type, (3) how to make the hiring
report better. Also consolidates every pending decision this touches.

**Read this first:** most of question (2) is already answered — `docs/ENTERPRISE-PORTAL-V2-SPEC.md`
locked a composition model for exactly this problem on 2026-07-17. Nothing in it is
built yet. This doc does not re-decide that; it sequences the build against it and
adds what the spec doesn't cover (which *formats* to build, and in what order).

---

## 0. Don't contradict these — already decided elsewhere

| Doc | What it already locked |
|---|---|
| `ENTERPRISE-PORTAL-V2-SPEC.md` | A `Module` unit with `envPrimitive` + `graderType` fields; assessments **compose** multiple modules rather than one grader trying to handle every format. Explicit non-goal: "does not change how ONE lab runs — changes how MANY are orchestrated." |
| `GRADING-SIGNALS-PLAN.md` §4 | SOC is a different KIND of work from cloud posture; a cloud-config-shaped taxonomy can't represent it. Names the 5 SOC domains and sketches what each would verify. |
| `ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md` | Reflection/soft-signal scoring stays advisory **forever** (EU AI Act / NYC LL144 exposure the moment an LLM-derived score moves rank). No composite score, no hire/no-hire verdict, no badges — enforced in report code. |
| `ENTERPRISE-ASSESSMENT-DESIGN.md` §8b | Embedding a *vendor* cloud console in an iframe was researched and rejected (`X-Frame-Options: DENY` on both AWS/Azure). This does **not** block embedding a first-party surface ShieldSync itself hosts — see §2 below, that's a live opportunity, not a closed door. |

---

## 1. New assessment formats

### The real cost driver is grading MECHANISM, not topic

Today's 2 labs (S3, Azure Storage) are one mechanism: candidate gets a live cloud
account, grader reads its API state after the fact. That mechanism is "free" to
extend — new topic, same plumbing. Three formats genuinely need something else:

| Mechanism | How it grades | Candidate access | New infra needed | Fits |
|---|---|---|---|---|
| **A. State-read** (existing) | Grader assumes a role, reads live API state, compares to expected | Cloud console/CLI, vendor's own UI | **None** — reuses 100% of today's plumbing | `network`, `workload`, `governance`, `incident_response` (all 4 remaining `live:false` cloud-posture domains); an access-review/least-privilege-audit scenario also fits here for free |
| **B. Structured-artifact comparison** | Candidate submits a structured judgment (classify N seeded items, flag N seeded issues); grader diffs against an authored answer key | A first-party ShieldSync page — no vendor console needed at all | Small: a static seeded-queue view + an answer-key format | `triage` (classify each seeded alert TP/FP + severity); an IaC/policy-review scenario (flag which resources in a given Terraform plan violate policy) also fits here |
| **C. Behavioral/replay** | Candidate authors an artifact (a rule, a playbook); grader **feeds seeded test traffic through it** and reads fire/no-fire or branch-taken behavior | A first-party editor + a live SIEM/SOAR instance | Real: a SIEM (Wazuh or Sentinel) + attack/benign traffic generators, or a SOAR tool (Shuffle or Sentinel playbooks) | `telemetry`, `detection_engineering`, `orchestration`/SOAR |

This is the same 3-way split `ENTERPRISE-PORTAL-V2-SPEC.md` §6 already named as
"state / investigation / attack-then-defend" grading philosophies — the framing
above just makes the **build-cost** ordering explicit, which is what a sequencing
decision needs.

### Recommended build order

1. **State-read domain expansion** (`network`, `workload`, `governance`,
   `incident_response`) — cheapest possible move: new grader function + new
   `lab.json` per domain, zero new infrastructure, zero new candidate-UI work.
   Do these on the existing single-lab v1 architecture, no orchestration change
   required. This is pure content work, same shape as the two labs that already exist.
2. **Alert triage** (Mechanism B) — the cheapest genuinely *new* format. It needs
   no live SIEM at all: a seeded, read-only alert queue is just data, renderable
   in ShieldSync's own UI. This is also the natural first candidate for a
   first-party embedded work surface (see §2) and the forcing function to build
   real multi-module orchestration, because it's the first module that would
   realistically compose alongside a cloud-posture lab in one assessment.
3. **Detection engineering** (Mechanism C) — the strongest, most marketable SOC
   format ("your rule caught the real attack and stayed quiet on the noise" is
   deterministic and hard to fake) but the first one needing real new infra.
   Build after step 2 proves there's employer appetite for a SOC track.
4. **SOAR/orchestration** (Mechanism C) — biggest lift, do last; needs a SOAR
   tool wired to seeded incidents with branching outcomes.

### Tooling choice for Mechanism C, when you get there

| | Wazuh (self-hosted SIEM) | Microsoft Sentinel |
|---|---|---|
| Cost | $0 marginal (matches your ~$7/mo infra discipline) | **Per-GB ingestion — real recurring cost, flag before enabling** |
| Control | Full — you own the box, seed data however you want | Cloud-managed, less control over cost-bounding a candidate session |
| Enterprise credibility | Lower name recognition | Higher — Sentinel is what a lot of buyers' own SOCs run |

Recommendation: **build the Wazuh version first.** It's free, keeps every session
cost near-zero the same way the AWS sandbox pool does, and proves the format works
before you take on Sentinel's metered cost. Add Sentinel once a real SOC-track
customer specifically asks for it — same "prove it small, then match the buyer's
stack" logic as the sales-kit design-partner motion. Same reasoning applies to
SOAR: **Shuffle (self-hosted) before Sentinel playbooks/Logic Apps.**

---

## 2. The unified lab environment

### What's already decided vs. what's genuinely new here

`ENTERPRISE-PORTAL-V2-SPEC.md` already answers "how do multiple formats compose":
independently-provisioned, independently-graded **modules**, aggregated only at
the report layer — not one generic environment/grader abstraction. That part is
settled; it just isn't built (`moduleCursor`/`moduleResults[]` on the invite, a
per-module lease/grade/advance cycle in the engine — named in the spec as "the
core engine change and the biggest one," not started).

What's genuinely new in this planning pass: **today's candidate environment isn't
actually unified even at the UX level.** `candidate-flow.tsx` has two fully
separate render paths — a bare AWS console link, and a 4-step Azure CLI
copy-paste block — and for *both*, all real work happens outside ShieldSync's own
UI, in the vendor's console. ShieldSync only owns consent → timer → "here are your
credentials, go work elsewhere" → reflection → submit.

The new Mechanism-B/C formats change that. A triage queue or a rule editor has
**no vendor console to link out to** — ShieldSync would be the first-party host of
the actual work surface for the first time. That's not just a format add, it's a
product opportunity: a genuinely single-tab, single-brand workspace for these
formats, plus finer-grained work-timeline data than CloudTrail event names give
you today (§8b's rejection of embedding was about *vendor* consoles' X-Frame-Options
— it doesn't apply to a page ShieldSync itself serves).

### What "unified" should mean, concretely, at three layers

| Layer | Today | Target |
|---|---|---|
| **Candidate-facing** | Two hardcoded branches (AWS console link / Azure CLI block); reusable shell (consent, timer, recording, reflection) already exists and is format-agnostic | Same reusable shell + a per-module **work-surface slot**: "new tab to vendor console" for cloud-posture modules, "embedded first-party panel" for triage/detection-rule modules — one shell, pluggable surface, not a third hardcoded branch |
| **Assessment composition** | One lease per invite, one lab, full stop | Multi-module orchestration per the v2 spec — lease→grade→teardown→advance to next module, invite carries a cursor |
| **Employer-facing report** | Already generic — `groupByDimension()` doesn't care what produced a criterion | Close to free once modules exist: the report layer needs no rework to aggregate 2-3 heterogeneous modules into one competency profile, because it already only consumes the `{id, domain, dimension, passed}` contract |

That last row is good news worth acting on: **the report side of "unified" is
mostly already built.** The real work is entirely on the candidate-environment and
orchestration sides.

### Phased build plan

| Phase | Ships | Depends on |
|---|---|---|
| **0 (now)** | 1-2 state-read domain labs (`network` or `governance`) on the existing v1 single-lab architecture | Nothing new — pure content work |
| **1** | Alert-triage module as a first-party embedded surface | Phase 0 content pipeline proven |
| **1b** | Multi-module orchestration (the v2 spec's "core engine change") | Built *alongside* Phase 1, since triage is the first module that needs to compose with a cloud-posture lab |
| **2** | Flip v1 → v2 create-flow | The spec's own explicit gate: not before ≥2-3 real modules exist |
| **3** | Detection engineering + SOAR (Wazuh/Shuffle) | Phase 1 validates SOC-track demand first |

---

## 3. Report improvements

Ranked by value/effort, respecting the locked constraints (no composite score, no
verdict, no rank-moving LLM scoring):

| Priority | Change | Why | Status |
|---|---|---|---|
| P0 | **Surface `frame.parameters` in the report header** | Directly backs the "N-point framework" marketing claim with a number computed from this specific candidate's run, not asserted | Already recommended in `GRADING-SIGNALS-PLAN.md`, still not built |
| P0 | **Severity-aware failure surfacing** (S2) | The actual tiebreaker a security hiring manager uses — a candidate who deleted the bucket vs. one who missed a hardening control are not equivalent at the same raw score | Already recommended, not built |
| P1 | **Before/after artifact diff** (e.g. the actual bucket-policy JSON, not just the CloudTrail event name that changed it) | Makes "what did they actually do" concrete evidence instead of inferred from an action-name trail | New in this pass |
| P1 | **Submitted-vs-expected view for Mechanism-B formats** | Once triage/IaC-review modules exist, the report needs a place to show what the candidate classified/flagged against the answer key — net-new surface, build alongside the format, not after | New in this pass, ships with §1 step 2 |
| P2 | **Rank on sub-checks, not criteria** (S1) | Roughly halves tie frequency without inventing precision | Already recommended, not built |
| P2 | **"What this does not tell you" line** (S4) | Protects the honesty differentiator, pre-empts over-reading a report | Already recommended, not built |

**Explicitly not recommended:** showing a "reference solution" alongside the
candidate's as if it were the graded answer. It could be added later as
*context*, clearly labeled as one valid approach among several — but that needs
its own explicit decision (see §4), not a quiet addition, since it risks reading
as an implied verdict the report otherwise deliberately avoids.

---

## 4. Decisions pending — consolidated

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **Branch reconciliation** — `hr-candidates-and-go-live` is 66 commits ahead of `master` (the default branch Dependabot and presumably deploy tracks) and 4 behind it; the 4 master-only commits are separate live money/UX fixes | Merge now / review master's 4 commits first / keep working on the branch and reconcile later | **Yours to call** — I did not merge; flagging only |
| 2 | L2 scored-objective count | 4 vs 5 per level | Open in `PORTAL-V2-SPEC.md`, unchanged by this doc |
| 3 | Same-cloud module env reuse vs. full isolation between modules in one assessment | Reuse (cheaper) vs. isolate (cleaner blast radius) | Open in `PORTAL-V2-SPEC.md` |
| 4 | Cut-score value | — | Open in `PORTAL-V2-SPEC.md` |
| 5 | v1 → v2 create-flow flip timing | — | Gated on ≥2-3 real modules per the spec; §2 phase plan above targets this |
| 6 | SIEM choice for detection engineering | Wazuh (free, self-hosted) vs. Sentinel (paid, per-GB, higher credibility) | **Wazuh first** — see §1 cost table |
| 7 | SOAR choice for orchestration | Shuffle (free, self-hosted) vs. Sentinel playbooks (paid) | **Shuffle first**, same reasoning |
| 8 | Whether Mechanism-B formats (triage, IaC review) ever get LLM-assisted grading of free-text answers | Keep to strictly structured/multiple-choice-per-item comparison vs. allow partial LLM matching | **Keep structured-only for now** — free-text LLM grading that affects rank re-opens the AEDT-regime exposure the reflection-scoring lock exists to avoid |
| 9 | Reference-solution display in the report | Never / show as unlabeled-context only / don't add | Flagged in §3, needs an explicit call before building |

Item 1 is the only one that's urgent and not mine to resolve. Everything else is
sequencing, not blocking — Phase 0 of §2 can start today without any of these
being settled.
