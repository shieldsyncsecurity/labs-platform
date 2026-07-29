# Grading signals — inventory, shortlist design, and the "N parameters" claim

Written 2026-07-25. Answers two questions the owner asked:
1. Out of 5 candidates, **who moves up the ladder** — how do we support that decision?
2. Can we honestly market that we **test on 10–20 parameters**?

---

## 1. What we can honestly claim TODAY (counted from code, not estimated)

The B2B enterprise assessment runs exactly one lab today:
`s3-misconfiguration-audit`. After the sub-check change shipped 2026-07-25:

| Criterion | Competency | Verified checks |
|---|---|---|
| No lab bucket allows anonymous public read | correctness | 2 (per bucket) |
| `auditor` no longer has `s3:*` on `*` | rigor | 1 |
| Each bucket denies unencrypted PutObject | rigor | 2 |
| Each bucket denies non-TLS requests | rigor | 2 |
| No bucket policy grants a wildcard principal | no_new_exposure | 2 |
| Both buckets still exist (secured, not deleted) | operational_safety | 2 |
| **Total** | **4 competencies** | **11** |

**Defensible marketing line:**
> "Every assessment verifies **11 distinct configuration checks** against the
> candidate's live cloud account, grouped into 4 competencies."

That is literally true and auditable — each check is a real API-verified state.

### What we must NOT claim

- **Not "20 parameters"** — not today. 11 is the number. Rounding up to 20 is the
  kind of overclaim that a security buyer will test and that permanently costs
  credibility. Say 11.
- **Do not count advisory signals as tested parameters.** Time on task, the
  work timeline, the recording and the reflection are *evidence we surface*,
  not *parameters we score*. Counting them to inflate a number would mean
  marketing dimensions we deliberately do not grade.
- **Do not count the same check twice** across criterion and sub-check level.

### How 10–20 becomes true honestly

The existing `ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md` already sizes this: hard cap
of **5 scored objectives per level**, each with **2–4 sub-checks** (§P4, §P5).
That is **10–20 verified checks by construction** — the claim becomes true for
the whole level range the moment the L2 flagship ships, without inventing
anything. Nothing new needs designing; it needs building.

The two B2C labs are thinner and should get the same treatment when touched:
`iam-privilege-escalation` (3 criteria) and `bedrock-prompt-injection` (3). The
IAM one decomposes naturally — its escalation check currently tests
`Attach|Put|Create|SetDefault|PassRole` in a single regex, so "you removed
AttachUserPolicy but left PassRole" is a real finding we currently hide.

---

## 2. Who moves up the ladder — shortlist design

### The problem, stated precisely

Ranking was `verified passed / verified total` at criterion level. With 6
criteria there are only 7 possible scores, so with 5 candidates **ties are the
normal case, not the edge case** — and the table silently ordered tied
candidates by array position. A hiring manager reading rank 1 vs rank 2 would
infer a distinction the assessment never measured. That is the most misleading
thing a shortlist can do.

### Shipped 2026-07-25

1. **Sub-check partial credit.** Five of six criteria were `buckets.every(...)`
   — securing one bucket and missing the other scored identically to doing
   nothing. Now each carries per-resource detail. `passed` semantics are
   unchanged (still `every`), so no score or rank moved; what changed is that a
   failure names the resource, and partial progress is visible.
2. **Competition ranking + explicit tie flag.** Equal scores now share a rank
   (1, 1, 3) and carry a `tied` marker whose tooltip says the assessment did not
   separate them and to use the competency breakdown plus the interview.

### Recommended next (not yet built)

| # | Change | Why it helps the ladder decision | Effort |
|---|---|---|---|
| S1 | **Rank on sub-checks, not criteria** (11 values instead of 6) | Roughly halves tie frequency without inventing precision — each sub-check is a real verified state | S |
| S2 | **Severity-aware failure surfacing.** A failed `operational_safety` (deleted the workload) or `no_new_exposure` (left another door open) is categorically different from a missed hardening control. Show the *class* of failure next to the rank. | This is the actual tiebreaker a security hiring manager uses. Two candidates at 5/6 are not equivalent if one destroyed the bucket. | S |
| S3 | **Pre-registered bar per level** (Angoff, §P8) → "meets / does not meet the provisional expert bar" | Absolute signal, not just relative. With 5 candidates, relative ranking alone is weak — the bar answers "is anyone here actually good enough?" | M |
| S4 | **"What this does not tell you"** line on the comparison report | Protects the credibility differentiator and pre-empts over-reading | S |

**S2 is the highest value per unit of effort** and I recommend it next.

### Deliberately NOT proposed

- **No composite /100, no hire/no-hire verdict, no badges.** Locked, and the
  report code enforces it. Ranking a shortlist is fine; declaring a hire is not.
- **No scoring of the reflection.** The moment an LLM-derived score moves rank,
  the full EU AI Act / NYC LL144 AEDT regime attaches — and the consent copy
  already promises candidates it does not.
- **No scoring of speed or event ordering.** It penalises the candidate who
  verifies before acting, which is the behaviour we want to select for.

---

## 3. Cross-variant comparability (open risk)

Per-session variance means candidate A may be graded on 6 criteria and candidate
B on 5 (one control shipped already-correct). Ranking is a *rate*
(`passed / total`), so it is roughly comparable — but the variants are not
proven equal in difficulty. Before `LAB_VARIANCE=1` is enabled with real
candidates, either:

- keep all candidates in one assessment on the **same variant** (simplest,
  recommended for the first customers), or
- prove pass-rate equivalence across variants at volume before mixing them in a
  single shortlist.

This is already implied by §P8's "percentile only at >=50 completions AND
verified variant pass-rate equivalence" — worth stating explicitly here because
it bites at the *shortlist* level, not just the percentile level.
