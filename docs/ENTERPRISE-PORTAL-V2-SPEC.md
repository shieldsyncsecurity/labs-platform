# ShieldSync Enterprise — Portal v2: Composed Assessments (Build Spec)

Status: **spec locked, build not started** · Owner-approved direction 2026-07-17 · Author reference: this conversation + `docs/ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md`, `docs/ENTERPRISE-ASSESSMENT-DESIGN.md`.

Interactive UX reference (recruiter picker): `docs/recruiter-picker-mock.html` (and the published artifact).

---

## 1. What v2 is, and what changes from v1

v1 (LIVE today): an **assessment = one lab**. The recruiter picks a single `labSlug` + a name + a hints toggle; one invite → one lab lease → one correctness score.

v2: an **assessment = a composed suite of modules**, targeted at a **job level**, graded into a **competency profile**. The recruiter picks *level + coverage*; the platform composes the module set.

| | v1 (live) | v2 (this spec) |
|---|---|---|
| Assessment content | one `labSlug` | ordered `modules[]` (1..N) across tracks |
| Targeting | (none) | `level` (L1–L5) + `coverage` (tracks, one primary) |
| Candidate attempt | one lease → one grade | a **sequence** of module sessions, each own-graded |
| Report | correctness-only, one number | per-module → per-competency **profile** + overall |
| Recruiter UX | 3-field form | level → coverage → composed preview → send |

**The organizing axis (locked):** `Level` (primary) × `Track` (AWS/Azure/SOC/AI Security) × `Domain` (secondary). **Vendor is never an axis** — it is at most a discovery tag. (Rationale in the content plan.)

---

## 2. Reality check — v2 is coupled to the module library

There is exactly **one** enterprise lab today (`s3-misconfiguration-audit`, in `enterprise/lib/labs.ts`). v2's entire value is *composing modules* — so **v2 the feature advances in lockstep with the module library**, which is content-authoring work (and Azure-gated for the Azure track). Building the full composition engine while only one module exists is framing a picture that isn't painted yet.

**Consequence for sequencing:** build the v2 *scaffolding* (data model, composition, report, UI) now behind a flag; it becomes genuinely useful as modules land. Do **not** replace the live v1 create-flow until there are ≥2–3 real modules to compose.

---

## 3. Data model

### 3.1 Module — the reusable unit (the LEGO brick)

A module is an independently-provisioned, independently-graded scenario. Authored once, reused across many assessments.

```
Module {
  moduleId        // stable id, e.g. "az-data-lock-l2"
  track           // "aws" | "azure" | "soc" | "ai"
  domain          // "data-protection" | "identity" | "detection" | "incident-response" | "prevention" | "prioritization"
  level           // 1..5 (the level this scenario is authored FOR)
  title           // recruiter/candidate-facing, e.g. "Lock the exposed store — app preserved"
  labSlug         // engine deploy target (the existing lease/deploy/grade unit)
  envPrimitive    // "cloud-account" | "cloud-rg" | "siem" | "vuln-app"  (what gets provisioned)
  graderType      // "state" | "investigation" | "attack-then-defend"   (grading philosophy)
  minutes         // budget contribution
  objectives[]    // scored objectives (per-objective pass/fail is the report granularity)
  variants[]      // seeded parameter variants (anti-cheat; randomized per candidate)
}
```

Key point: **a module maps 1:1 onto the engine's existing lease→deploy→grade→teardown unit** (`labSlug`). v2 does not change how ONE lab runs — it changes how MANY are orchestrated and aggregated.

### 3.2 Assessment — backward-compatible extension

Extend `ShieldSyncEntAssessments` items with optional v2 fields. **A v1 assessment is exactly a v2 assessment with one module.**

```
Assessment {
  assessmentId, orgId, name, reportToken, createdAt   // unchanged
  labSlug?        // v1 (retained; = single-module assessment)
  hintsOn         // unchanged
  // --- v2 additions (all optional; absence => v1 behavior) ---
  level?          // 1..5
  coverage?       // { primary: track, supporting: track[] }  (what the recruiter picked)
  modules?        // [{ moduleId, labSlug, track, weight }]   (the composed suite, ordered)
  schemaV?        // 1 | 2   (default 1)
}
```

`createAssessment()` accepts EITHER shape: if `modules[]` present → v2; else wrap `{labSlug}` as `modules:[{labSlug, weight:1}]`, `schemaV:1`. Everything downstream reads `modules[]`.

### 3.3 The hard part — multi-module attempt orchestration

v1: one invite → `book` → `start` (one lease) → `submit` → grade → teardown.

v2: one invite → a **sequence** of module sessions. Each module: lease/deploy its env → candidate works → submit that module → grade → teardown → next module. The invite tracks `moduleProgress[]` (which module, its session, its per-module result). The candidate flow already anticipates a sequence (it's modular UI-side).

This is the **core engine change** and the biggest one:
- Invite gains `moduleCursor` + `moduleResults[]`.
- `/ent/start` leases the *current* module's env; `/ent/submit` grades it, tears down, advances the cursor (or finishes).
- Optimization: consecutive same-cloud modules MAY reuse one account/RG (fewer leases) — but default to clean env per module for grading isolation (no cross-module state bleed — the whole reason modular beats monolithic).
- Timebox is per-module (sum = assessment budget); the overall attempt can span modules with brief between-module transitions.

### 3.4 Report — competency aggregation

```
Report {
  perModule[]     // { moduleId, track, objectives:[{name, pass|fail|partial}], moduleScore }
  perCompetency[] // { track, score }   // aggregate module scores within a track
  overall         // weighted aggregate (weights from modules[].weight)
  band            // "recommend" | "consider" | "below-bar"  (deterministic from cut score)
}
```

The **per-competency profile is the headline** (e.g. AWS 82 / AI 70 / Detection 90), NOT a single blurred number. Heterogeneous graders (state vs investigation vs attack-then-defend) aggregate into a profile precisely because each module is scored on its own philosophy first.

---

## 4. Composition rules (recruiter selection → module set)

Given `level` + `coverage {primary, supporting[]}`:
1. **Primary track:** pick modules at/below `level`, prefer closest to level. Count by level: L1→1, L2→2, L3→2 (incl. one broader incident), L4→2–3 (incl. guardrail), L5→2.
2. **Each supporting track:** one flagship module at/below level. **Cloud-secondary** (Azure when AWS is primary, or vice-versa) → a short **transfer-check** module (~10 min), not a full lab.
3. **L5 capstone:** append the heavily-weighted **prioritization** module.
4. **Guardrail:** 1 primary + ≤2 supporting. Never all-tracks-equal (avoids shallow-everywhere).
5. **Duration** = Σ module minutes (scales with level by adding modules, not by making one harder).

(The mock implements this exactly — see `compose()` in `recruiter-picker-mock.html`.)

---

## 5. Deterministic gamification (recruiter-facing; formulas)

Every element is a **pure function of real data** — no randomness, no vanity points. Gamify the *workflow/clarity/ROI*, never the hiring *judgment* (no rewards for deciding fast — fairness/legal risk).

- **Role-fit meter** (build step): `f(#areas, level)` → Focused 58% / Solid 82% / Comprehensive 100%; drops to "Narrow for a senior role · 45%" at L4–L5 with one area.
- **Time-saved** (results): `submitted × ~1.5h` of first-round screening replaced (tune the constant).
- **Shortlist band** (results): candidates with `overall ≥ cut(=70)` → "meets the bar"; highest scorer → "Top match" chip; green edge on qualifying rows.
- (Later) **Benchmark percentile**: candidate's rank among all who took this exact assessment — valid only at N ≥ 50; deterministic given the pool.

---

## 6. Grading philosophy per track (must be right per module)

| Track | Env primitive | Graded on |
|---|---|---|
| AWS / Azure Security | cloud account / RG | resource end-state (private, least-privilege, app preserved) |
| SOC / Detection | self-hosted SIEM (Wazuh/Splunk-free) + replayed logs | investigation quality (true positive, severity, rule precision/recall) |
| AI Security | deliberately-vulnerable LLM app/agent | attack-then-defend (found + fixed the guardrail gap, agent still works) |

Cloud grades on state, SOC on investigation, AI on attack-then-defend. Modular composition is the ONLY way to combine incompatible graders in one assessment.

---

## 7. Migration / backward compatibility

- Existing v1 assessments keep working untouched (`schemaV:1`, `modules` derived from `labSlug`).
- v2 create-flow ships behind a flag / new route; the live v1 form stays until the module library supports composition.
- `enterprise/lib/labs.ts` grows from a slug allowlist into the **module catalog** (add `track/domain/level/graderType` to each entry) — kept as the single source of truth shared by form + server guard.

---

## 8. Phased build order

| Phase | What | Blocked by |
|---|---|---|
| **0 — Spec** | this doc + mock (DONE) | — |
| **1 — Data model** | module catalog in `lib/labs.ts`; `createAssessment` accepts `modules[]`+`level` (back-compat); report shape | — (non-Azure) |
| **2 — Attempt orchestration** | engine: invite `moduleCursor`/`moduleResults`; start/submit advance the sequence; per-module teardown | — (engine; gated deploy) |
| **3 — Portal v2 UI** | real Next components porting the mock (level → coverage → composed preview → send), feature-flagged | Phase 1 |
| **4 — Competency report** | per-module → per-competency roster + bands + gamification | Phase 2 |
| **5 — Module library** | author AWS/Azure/SOC/AI modules × levels | **content authoring + Azure tenant** (the long pole) |

Phases 1–4 are the *scaffolding* and are largely non-Azure-blocked. Phase 5 (the modules) is the real bottleneck and paces the whole thing — v2 is only as good as the library it composes.

---

## 9. Open decisions for the owner

- **L2 scored-objective count:** content plan says 5, design doc says 4. Recommend 4 scored + 1 bonus. Freeze before authoring the first composed assessment.
- **Same-cloud module reuse:** clean env per module (grading isolation, default) vs reuse one account across consecutive same-cloud modules (fewer leases, cheaper) — decide before Phase 2.
- **Cut score:** the shortlist bar is deterministic but its *value* (70?) needs the known-groups pilot before it's published; report at objective granularity with a band until then.
- **When to flip v1 → v2 in prod:** recommend at ≥3 real modules across ≥2 tracks, not before.
