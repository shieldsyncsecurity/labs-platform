# ShieldSync Enterprise — AWS Security Hiring Assessment Content Plan (L1–L5)

**Status: DRAFT v2 — 2026-07-11. Owner review pending. Nothing in this document is built.**
v1 was produced from a 9-stream research pass (JDs by level, NICE/SANS/SFIA/GitLab ladders,
SCS-C02 / Well-Architected / SRA / AWS Security Maturity Model, competitor teardowns,
assessment science, psychometrics, leakage countermeasures, 2026 AEDT/AI-hiring law), then
attacked by three adversarial reviews (engine feasibility — verified against the actual SCP,
nuke config and graders in this repo; measurement validity; buyer/candidate realism). v2
integrates all 54 findings. Blockers the critique caught before they were built: SCP-denied
resources in two scenarios, a nuked-default-VPC dependency for all SG work, two
objective-vs-canary contradictions, and a stub-the-canary cheat path.

---

## 0. Thesis

Every competitor differentiates seniority with a difficulty slider on one question format.
The research says seniority is a **different kind of work**: Analysts *detect and triage*,
Engineers *implement controls*, Senior Engineers *diagnose ambiguity and fix root causes
without breaking things*, Architects *design policy and add guardrails that prevent
recurrence*, Leads *prioritize under constraint and articulate trade-offs*. Each level gets a
structurally different scenario and objective set — all graded by the deterministic
state-inspection engine already in production.

## 1. Design principles

| # | Principle | Basis |
|---|-----------|-------|
| P1 | Work-sample, not quiz. Never add MCQs. | Highest-validity method class (Sackett 2022, ~.33) |
| P2 | 100% deterministic grading, zero human rubric ("zero rater variance"). | Structure beats holistic judgment in every meta-analysis |
| P3 | Different task *kinds* per level — this is also what makes per-level job-relatedness (UGESP) defensible. | JD research + competitor gap |
| P4 | 60 minutes fixed. Depth = fewer, richer objectives — **hard cap 5 scored objectives per level** (v2: was 6–7; the clock didn't close). | Completion-band data + critic time-math |
| P5 | Partial credit via sub-checks (2–4 per objective). Honesty rule: sub-checks within an objective are correlated, so reliability math and the SEM band are computed at the **objective** level (~5 items), not the sub-check level. | RHCSA/OSCP/CKA pattern + local-dependence critique |
| P6 | The account boundary is the anti-cheat. No proctoring. AI/docs explicitly allowed; a second human explicitly prohibited; both stated in writing pre-start. | Anti-cheat research; AI-era realistic job preview |
| P7 | Deterministic score decides rank; reflection is advisory **forever** (keeps the grader outside EU-AI-Act/LL144 AI definitions; the LLM score moving rank attaches the full AEDT regime). Consent copy must say: "your written answers don't change your score but are shown verbatim to the employer." | Regulatory research |
| P8 | No fake precision: integer points, per-objective breakdown, explicit "effectively tied" band. Percentile only at ≥50 same-level completions AND verified variant pass-rate equivalence (v2: raised from 20–30). Never cross-level ranking. Cold-start anchor = "meets / does not meet the provisional expert bar" (Angoff). | Psychometrics |

## 2. Taxonomy × gradeability (v2-corrected)

| Domain | Gradeable here | Notes / v2 corrections |
|--------|---------------|------------------------|
| IAM | **Best fit** | Policy-doc analysis (in prod) + Access Analyzer `CheckNoNewAccess`/`CheckAccessNotGranted`/`CheckNoPublicAccess`. Reference policies must be **generous envelopes validated against 3–5 distinct correct solutions** — a single hand-authored reference fails defensible alternatives. Graded conditions: `aws:SecureTransport` yes; **`aws:SourceIp` never** (it breaks AWS-service-originated calls — the canary — and punishes candidates who know that). |
| Data protection | **Strong** | Encryption config state, KMS CMK + rotation, BPA, TLS-only, Secrets Manager. **Never grant `kms:PutKeyPolicy`** (lockout → unmanageable CMK → permanently dirty pool account); key policy is set in the CreateKey wizard and "key policy retains account-root access" is itself a graded correctness sub-check. **Drop the deny-unencrypted-PutObject-header pattern** (post-2023 default SSE means SDKs don't send the header → denies the canary on every correct solution); grade encryption *configuration* instead. |
| Detection | **Strong, pre-seeded only** | Evidence is CFN-seeded (pretty-printed JSON "exported logs" at L1 — not .gz; instructions state Event history won't contain the incident window). Config-rule objectives: **recorder pre-seeded by CFN, scoped to S3 bucket types** (pennies); candidate creates a MANAGED rule (grade `sourceIdentifier`), custom-Lambda rules banned. One graded detection path per objective — never "Config rule OR EventBridge". |
| Infrastructure | **Strong after the VPC fix** | All SG/NACL work depends on E10 (aws-nuke currently deletes the default VPC and the SCP denies recreating it — SG objectives cannot deploy until the nuke filter preserves default VPC + subnets/IGW, and pool accounts are audited). WAF removed from the menu (needs ALB/CloudFront attachment — cost, VPC, warm-time). |
| Incident response | **Strong** | Isolate/contain as answer-by-action. Cross-account "still trusted" checks are graded by trust-policy document inspection (never a live AssumeRole probe); seeded external principals = the platform account. |
| Governance | **Smallest** | Account-local proxies only. Organizations/SCP/Control Tower content excluded at every level, permanently. |

**Seeding constraints verified against the SCP:** no EC2 instances, no NAT gateways, no EIPs,
no new VPCs can be created in sandbox accounts. Scenario seeds must come from: S3, Lambda,
IAM, KMS, Secrets Manager, SSM, DynamoDB, CloudTrail, Config, GuardDuty, CloudWatch,
EventBridge, SNS. Cost probes use over-provisioned DynamoDB or unused CMKs, never NAT/EIP.

## 3. Cross-cutting authoring rules (new in v2 — every scenario must satisfy all of these)

1. **The legitimate application ("canary") is candidate-visible and testable.** Instructions
   name it in business language ("the pipeline's processor function must keep working — test
   it anytime: `aws lambda invoke …`"); `lambda:InvokeFunction` on its ARN is in the
   learnerPolicy. The word "canary" never appears in candidate copy.
2. **Canary integrity:** no `lambda:UpdateFunctionCode`/`UpdateFunctionConfiguration` on it in
   any learnerPolicy; grader pins `CodeSha256` against the stack; the canary proves work via a
   side effect the grader reads back (nonce object written), not its return value.
3. **Canary must survive every correct solution** — an authoring gate, not a hope. Any
   objective whose correct implementation could break the canary is a design bug (this killed
   the deny-unencrypted-header objective and the `aws:SourceIp` reward in v1).
4. **Canary scoring is capped at ONE dedicated "application preserved" objective** per
   assessment — a canary accident must not cascade across every objective it touches.
5. **Grader invokes the canary with retry/backoff** (3 attempts over 2–3 min — IAM/S3
   propagation lag is real); invoke error ⇒ `unknown`, never fail.
6. **Reference-solver ship gate:** a scripted model solution runs *under the actual
   learnerPolicy* for every variant and must pass 100% of sub-checks; expert solve time must
   be ≤ 40 min for a 60-min box (≤ 30 min at L3+), or objectives get cut.
7. **Variant self-test harness:** every variant is deployed, graded in seeded (all-fail)
   state, remediated by script, re-graded (all-pass), then nuked — `ready:true` is per
   **variant**, not per scenario.
8. **Ground truth lives engine-side only** (deploy-time worker reads CFN Outputs → truth
   record in DynamoDB; graders read the record). Resource tags carry only the inert
   watermark. `cloudformation:Describe*` is never granted to candidates.
9. **learnerPolicy char budget is a go/no-go authoring gate** (≤ ~1700 minified) — drafted
   *before* an objective list is frozen; parameterized names preserve `sslab-*` / `/lab/`
   prefixes so prefix-scoped statements keep working.
10. **Objectives must not invalidate each other's evidence** (e.g., account-BPA flips every
    bucket's public status → the find-the-public-bucket objective is graded against the truth
    registry, never live policy status).
11. **Statement-removal sub-checks are always paired with "legitimate statements preserved"**
    — deleting the whole policy must not earn root-cause credit.
12. **`unknown` results are never silently scored as fail:** retry with backoff; if still
    unknown, the result is quarantined for owner re-grade against the still-live account
    before release to the employer.
13. **Order/timing signals are advisory-only, forever** (they penalize verify-before-act; and
    CloudTrail LookupEvents lags ~15 min, missing exactly the final-minutes actions).
14. **Tags-as-answers are typo-proof:** exact key/value strings provided copy-paste in the
    instructions, graded case-insensitively and trimmed; the precision rule ("tag only the
    affected resource — extra tags count against you") is stated up front, never a surprise.
15. **Every trap is discoverable:** any "legitimate exception" carries in-environment evidence
    (a `purpose=` tag, a README/config object, an actual consumer resource). Grading telepathy
    is prohibited; on a real job you'd ask a colleague — in the sandbox the evidence is the
    colleague.
16. **Pilot each level with a person AT that level** (not just the owner — an expert test
    can't surface L1 false-negative sources) before `ready:true`.

## 4. The five levels (v2)

All levels: 60 min + 15 grace, CFN pre-deployed, ≤5 scored objectives, sub-check partial
credit, one canary objective, reflection (advisory).

### L1 — Cloud Security Analyst · "Triage the alert queue"
*Construct: detection, triage, evidence-reading, precise attribution. AI-era framing: can the
candidate extract the right facts from an account to even ask the right questions.*

Five objectives: (1) identify the actually-public bucket among lookalikes → tag it (graded vs
truth registry; copy-paste tag strings); (2) trace the compromised IAM user from pre-digested
seeded evidence → tag + deactivate its key (legit user untouched); (3) close the seeded SG
hole, preserve the legitimate rule *(depends on E10 VPC fix — if delayed, substitute an
S3-scoped exposure finding)*; (4) account-level BPA on; (5) credential hygiene (stale key
found + deactivated). Reflection: most urgent finding and why; what would you escalate?

### L2 — Cloud Security Engineer · "Harden the pipeline" *(flagship — build first)*
*Construct: implement controls correctly end-to-end without breaking the workload.*

Scenario: data-pipeline account — two buckets, pipeline IAM user, processor Lambda (the
candidate-testable legitimate app), hardcoded secret, logging off.

Five scored objectives:
1. **Root-cause the public exposure**: BPA + offending `Principal:"*"` Allow statement
   removed + legitimate statements preserved.
2. **Encryption + transport**: default-SSE config verified + TLS-only deny present
   (folded into one objective; no deny-unencrypted-header pattern).
3. **Least-privilege the pipeline user** — graded purely by policy-document analysis
   (wildcard gone / scoped to correct ARNs / read still granted). Deliberately NOT coupled to
   the canary (the Lambda runs on its own role; a user-policy change can't affect it).
4. **CloudTrail**: multi-region trail + log-file validation + destination locked. (Cost note:
   second management-event copy ≈ ₹3–8/session — in budget. Verify console behavior under the
   region-lock SCP in the owner test.)
5. **Secrets out of code + application preserved** (the canary objective): the Lambda ships
   reading `SECRET_ARN` with fallback to a hardcoded `SECRET_VALUE` env var; candidate creates
   the secret, sets `SECRET_ARN`, removes `SECRET_VALUE`, attaches the pre-created read policy
   to the function role, and can test the invoke themselves. No code editing — no
   `UpdateFunctionCode` in the learnerPolicy.
Bonus sub-check (uncounted in the bar): GuardDuty enabled.
Reflection: what did you fix first and why; one weakness that wasn't on the list.

### L3 — Senior Cloud Security Engineer · "Live incident: leaked credential"
*Construct: diagnosis under ambiguity, unprompted blast-radius sweep, root cause, policy
authorship. Level-critical objectives (2 and 4) carry ≥40% of points — the cut score is
arithmetically unreachable on mechanics alone, and the report flags which band each passed
objective belongs to ("passed L3 mostly on L2-band items" is visible to the employer).*

Scenario: leaked access key (flagged). The same secret is seeded in **2–4 locations depending
on variant** (flagged Lambda env var + some of: second Lambda's env, S3 "config file" object,
SSM plaintext parameter — EC2 user-data is SCP-impossible and replaced; varying the count
kills the "it's always 3 places" Telegram meta-leak). A similar-looking decoy key exists.

Five objectives: (1) contain the right credential (decoy untouched); (2) **full sweep — every
seeded location remediated** (level-critical); (3) rotate properly into Secrets Manager +
application preserved (canary objective); (4) **author the replacement policy** against a
written spec naming its required conditions — graded by `CheckNoNewAccess` vs a validated
generous-envelope reference + `CheckAccessNotGranted` denylist + the named condition keys
checked semantically (level-critical); (5) root cause: offending statement removed +
legitimate statements preserved + trust policy scoped. Attribution folds into objective 1's
sub-checks. Reflection: reconstructed timeline; 30-day monitoring plan; one thing you chose
NOT to do and why.

### L4 — Cloud Security Architect · "Design the guardrails"
*Construct: policy design, prevention-of-recurrence, judgment about exceptions — with every
exception evidenced in-environment.*

Scenario: post-remediation account that must resist the *next* incident. The v1 public-CDN
"leave it alone" trap is **redesigned**: the strongest architect's correct fix (private bucket
behind a distribution) must never grade as failure — the exception surface now has **two
deterministic pass states** (documented-exception untouched OR properly re-architected with
the consumer still served), or uses only exceptions with no strictly-better remediation (the
cross-account analytics trust, seeded to a platform-controlled account and graded by
trust-policy inspection).

Five objectives: (1) author the guardrail/permission-boundary policy against a constraint
spec (Access Analyzer-graded, hardest authoring task in the product); (2) data-protection
depth: CMK created with correct wizard-set key policy (root access retained — graded),
rotation on, bucket moved to SSE-KMS; (3) preventive control: managed Config rule on the
pre-seeded recorder catching the public-bucket class; (4) detection pipeline hardened
(validation + locked log bucket + ONE metric-filter alarm — single path); (5) judgment under
noise: the evidenced legitimate exceptions still function (canary objective) while the three
real misconfigurations of the same shape are fixed. Reflection (heavier): defend the guardrail
— what it deliberately allows; residual risk accepted; what you'd escalate to an org/SCP layer
in a 50-account estate.

### L5 — Security Lead · "The posture review" *(renamed from "Manager" — build last)*
*Sold as a **technical prioritization screen** — an L4 add-on module, not a management
assessment. Every leveling framework agrees manager-vs-architect is organizational scope,
invisible in a solo hour; pretending otherwise taxes the credibility of the other four levels.*

Scenario: ~10 findings across domains — deliberately more than one person can fix — blast
radius decoupled from list order; one evidenced business exception; one pure-cost probe
(over-provisioned DynamoDB / unused CMKs — NOT a NAT gateway, which the SCP can't even
deploy). Some findings seeded as artifacts (a report object) rather than live resources to
keep template complexity and warm-time sane.

**The prioritization is itself machine-graded and speed-decoupled** (v2 — this was the
critical fix): the candidate must tag *every* finding `decision=fix-now|defer|accept` +
`tier=critical|high|medium|low`. Objective 1 — the heaviest-weighted — grades that ranking
against the authored blast-radius ground truth. Objectives 2–4 are the top-tier fixes
themselves (weighted by severity); objective 5 is the exception/canary objective. A perfect
prioritizer who executes only the top two findings outscores a fast fixer with bad ranking —
which is the construct. **Pre-start brief discloses the format verbatim**: "there are more
findings than one person can fix in an hour; you are scored on impact-weighted prioritization;
some findings may be deliberate business exceptions — verify before you change them."
Reflection (heaviest): the deferred items and why; residual-risk statement addressed to a CTO;
what you'd assign to an analyst vs an engineer.

### Discriminator ladder (all machine-detectable)

| Signal | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| Precise detection/attribution (no hedge-tagging) | ● | ● | ● | ● | ● |
| Correct control implementation | | ● | ● | ● | ● |
| Root cause removed + legitimate statements preserved | | ● | ● | ● | ● |
| Application still works (canary objective) | | ● | ● | ● | ● |
| Unprompted blast-radius sweep | | | ● | ● | ◐ |
| Policy authorship passing Access Analyzer checks | | | ● | ● | |
| Adds preventive/detective guardrail | | | | ● | ◐ |
| Evidenced-exception judgment | | | ◐ | ● | ● |
| Ranking accuracy under over-scoped queue | | | | | ● |

## 5. Scoring & reporting

1. Weighted sub-check partial credit; composite = integer points.
2. **Level-critical weighting**: each level's defining objectives carry enough weight that the
   bar is unreachable without them; the report shows band composition per objective.
3. **Cold start**: Modified Angoff at the *objective* level (not per sub-check), panel of 5–8
   with a 30-min calibration exercise first, median not mean, provisional cut biased one
   objective downward (untrained raters over-estimate), reports labeled "provisional expert
   bar" with a widened tie band until re-equating at 30–50 completions per level.
4. **Tie band** computed at objective granularity; percentile unlocked at ≥50 same-level
   completions AND no significant per-variant pass-rate divergence (tracked from completion
   #1). Blast-radius weights are printed with one-line rationales ("exposed admin credential —
   full account-takeover path"); the weighting rubric is published.
5. Reflection: advisory forever; verbatim to employer; consent copy says so.
6. No verdict bands, no hire/no-hire, no decimals — unchanged.

## 6. Content security (right-sized to actual volume)

Reality check from the critique: at today's pool (3 accounts, 1 enterprise-reserved) the
ceiling is ~6–8 assessments/day — **pool expansion is a named Phase-1 dependency for batch
sales**, and elaborate exposure math is meaningless before it. Right-sized sequence:
- Now: parameterized names (prefix-preserving), engine-side truth registry, per-variant
  watermarks (styled as mundane cost-center-ish tag values, not entropy blobs that read as
  planted clues), K-of-N seeding *within* each scenario (incl. varying structural counts like
  secret-location count that would otherwise meta-leak).
- At volume: exposure caps (~20%/variant), reserve pools, refresh triggered by exposure
  counts (not the calendar — a solo founder cadence that slips is worse than none), 24–48h
  leak quarantine keyed off a crawl of Glassdoor/Telegram/LinkedIn write-ups.
- Pre-knowledge flags: **variant-specific artifacts only** (touching a resource that exists
  only in a *different* variant), ≥2 independent signals, human review only, never
  auto-surfaced to the employer, and session-activity monitoring disclosed in consent. A
  diligent senior doing unprompted hardening must never trip a cheating flag — L3 *rewards*
  unprompted work.

## 7. Engine work (v2 table)

| Δ | What | Size | Notes |
|---|------|------|-------|
| E0 | Per-level learnerPolicy drafted + char-budget gate (extend `verify-leastpriv.mjs`) **before** objective lists freeze | S | New — blocker-class if skipped |
| E1 | Weighted sub-checks + integer composite + report tree + **unknown-quarantine flow** (retry → owner re-grade before release) | M | |
| E2 | Truth registry: deploy-time CFN Outputs → DynamoDB record; graders read registry, zero hardcoded names | M | Replaces v1 "read truth from tags" (in-console answer-key leak) |
| E3 | Access Analyzer client + reference-envelope store (each validated against 3–5 correct solutions) | M | |
| E4 | Canary invocation: `lambda:InvokeFunction` from grader (read-only-model exception — owner sign-off), retry/backoff, side-effect nonce, CodeSha256 pin | **M** | v1 said S — wrong; nothing to "generalize", the prod check is static policy analysis |
| E5 | CFN parameterization + K-of-N + variant registry + watermark | L | Exposure counters deferred to volume |
| E6 | Report: tie band, percentile gating, band-composition flags, level-picker + floor/ceiling copy, advisory reflection panel | M | |
| E7 | Angoff capture (spreadsheet fine) + per-level provisional-bar storage | S | |
| E8 | Phase 2, advisory-only: CloudTrail order/timing annotations (≥20-min-old events only; never scored) | L | |
| E9 | Compliance: rubric/version stamp on every result; retention = **no-delete policy + weekly cross-region export** (PITR is 35-day recovery, not retention); AI-use + monitoring disclosure in consent; dormant demographics hook | S–M | |
| E10 | **aws-nuke default-VPC preservation** (filter IsDefault=true + subnets/IGW/route tables) + audit whether pool accounts still have default VPCs (if not: management-account recreation — owner-gated) | M | Blocker for all SG/NACL objectives |
| E11 | Variant self-test harness (deploy → grade seeded fail → scripted fix → grade pass → nuke); `ready:true` per variant | M | |

## 8. Go-to-market constraints (new in v2 — deal-killers live here, not in content)

1. **Level mis-picking is the #1 real-world failure.** GCC/services ladders (Big-4
   Analyst→Consultant→Manager, Wipro/TCS bands, "Module Lead") don't map to our five titles —
   a Deloitte "Consultant" req is anywhere from L2 to L4. Ship: a 5-question level-picker at
   assessment creation (does the role author IAM policy? own IR? design controls?), a
   GCC-title mapping table, level names sold as work-samples ("Detect & Triage" / "Implement
   Controls" / "Own the Incident" / "Design the Guardrails" / "Prioritize the Posture"), floor/
   ceiling report copy ("passed all L2-band objectives inside this L4 assessment — consider an
   L2 assessment"), and one free re-level per batch.
2. **Throughput honesty**: publish scheduled-slot capacity; don't sell "screen 50 by Friday"
   until the account pool supports it. Pool expansion = named dependency.
3. **Buyer-compliance pack** (Phase-1 deliverable): security whitepaper, DPDP data-handling
   note, integrity-monitoring disclosure, bias-audit-readiness statement — dovetails with the
   ISO 27001 certification the owner is already pursuing; GCC vendor-risk questionnaires gate
   every deal before content quality is ever discussed.
4. **Batch workflow before batch sales**: CSV bulk invite + results export (ATS integrations
   later).
5. **Pricing is level-priced from day one** (even if L2/L3 both open at ₹1,499) so the credit
   unit never gets redefined under existing customers. The exposure is L1 volume economics
   (campus-scale screening at flat ₹1,499 is unsellable against a zero-marginal-cost
   HackerRank seat): L1 gets volume tiers or is de-emphasized as a lead SKU; L3/L4 carry the
   premium (authoring cost, smaller pools).
6. **AI-allowed is a segment choice**: it forfeits clients who mandate AI-banned screens
   (one-product rule means no per-company toggle). Stated on the sales page; owner signs off.

## 8b. Console delivery: new tab + floating companion (researched 2026-07-11)

Owner asked whether an embedded in-frame live console (Hyperbeam/Kasm-class streamed browser)
would beat the separate console tab. Four-lens research verdict:

- **Direct iframing of the real console is impossible** — live header capture confirms
  `X-Frame-Options: DENY` on signin.aws.amazon.com, console.aws.amazon.com AND CloudShell,
  with no opt-in toggle (AWS ships such toggles for DCV/Connect — the console omission is a
  deliberate security posture). Header-stripping proxies break cookie/CSRF/nonce binding and
  edge into AUP territory. **Never build this.**
- **Every incumbent that offers a REAL provider console opens it in a new tab** (Qwiklabs/
  Skills Boost instruct users to). Platforms that look embedded (Instruqt-style) stream a
  remote desktop — a different, heavier architecture.
- **Streaming is possible but wrong for a timed, scored assessment**: India→us-east-1 input
  latency, documented copy-paste breakage in this product category, WebRTC blocked on
  corporate networks (our candidates may sit on a current employer's laptop), and cost 10–100×
  the per-session target for managed options (WorkSpaces Secure Browser bills per-MAU ≈
  ₹670/candidate; AppStream ≈ ₹11–17 + cold start; self-hosted Kasm/neko/Guacamole hit the
  cost target but add real ops burden). Candidate-minutes lost to streaming lag are a
  fairness/validity problem, not just UX. CloudTrail already gives the tamper-evident session
  record streaming would have added.
- **Adopted pattern**: keep the new-tab federated console + add a **Document
  Picture-in-Picture floating companion** — an always-on-top mini-window (Chrome 116+/Edge;
  ~95% of Indian desktop share) carrying the countdown, objective checklist, "test the
  application" command, and submit button, so the candidate never feels lost between tabs.
  Fallback for other browsers: live countdown in the tab title/favicon + a prominent
  "back to assessment" habit line in instructions. India candidates are overwhelmingly
  single-laptop-screen users — a floating overlay beats split-window guidance.
- Optional later, only on explicit customer demand for visual proctoring: a pilot of
  Kasm/Hyperbeam as a separate "recorded mode" — never as the default scored path.

## 9. Build sequence

| Phase | Ship | Gate |
|-------|------|------|
| 1 | **L2 Engineer** + E0–E4, E10, E11 + buyer-compliance pack + level-picker | Reference-solver ≤40 min under learnerPolicy; canary survives all correct solutions; L2-level pilot tester |
| 2 | **L3 Senior** + E5 | Variant self-tests green; secret-location count varies across variants |
| 3 | **L1 Analyst** | L1-level pilot tester (not owner) |
| 4 | **L4 Architect** | Exception surfaces have dual pass-states validated |
| 5 | **L5 Security Lead** | Ranking-objective ground truth Angoff-rated; pre-start disclosure copy |

## 10. Owner decisions needed

1. **L5 rename + positioning** ("Security Lead — technical prioritization screen", add-on to
   L4). Recommended: yes — the "Manager assessment" label is a credibility tax.
2. **AI-tools policy** (allow AI/docs, prohibit second human, disclosed pre-start; forfeits
   AI-ban-mandate clients). Recommended: allow.
3. **Read-only grading exception** for canary invocation (E4). Recommended: yes, scoped to
   `lambda:InvokeFunction` on stack-owned functions.
4. **SCP stance on EC2**: keep the deny and design content without instances (recommended) vs
   a ShieldSyncLabExec carve-out for scenario realism.
5. **Candidate feedback**: domain-level summary only ("data protection: strong; IAM: gaps") —
   balances candidate experience vs objective-list leakage. Decide before Phase-1 report copy.
6. **Level pricing now** (§8.5) — one sentence on the rate card before the first demo.
7. **Angoff panel names** per level (5–8 people, 30-min calibration each).

---
*v2 sources: 2026-07-11 research run (9 agents, ~90 URLs) + adversarial critique run (3
reviewers; feasibility reviewer verified claims against `infra/scp-sandbox-deny-expensive.json`,
`engine/labinfra.mjs` nukeConfigFor, `engine/graders.mjs`, and measured learnerPolicy sizes).*
