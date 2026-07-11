# Candidate flow — build status (2026-07-12, overnight autonomous build)

**Live private preview:** https://enterprise.shieldsyncsecurity.com/preview/candidate
(hidden, noindex, robots-disallowed, unlinked from any nav — owner review only; open it
from your phone). Source: `enterprise/app/preview/candidate/{page.tsx,candidate-flow.tsx}`.

This is the **real production front-end** of the candidate assessment (not the HTML mock) —
the reusable UI layer we wire to the Azure backend once A0 is done. Built and verified
autonomously per owner go-ahead.

## ✅ REAL and working now (verified: build green + driven in-browser)

| Piece | Real? | Notes |
|-------|-------|-------|
| All 10 screens (invite → consent → readiness → OTP → pre-brief → booking → lobby → room → reflection → done) | ✅ real React | production components, app design tokens, a11y skip-link inherited |
| Consent gate | ✅ | Continue disabled until all 4 itemized (DPDP) ticks incl. the recording notice |
| **Readiness check** | ✅ real browser APIs | real `getUserMedia` camera preview + **live mic level meter** (AudioContext analyser); real **bandwidth probe** (timed asset fetch → Mbps); real feature detection: Document-PiP support, Chromium/desktop, screen size; real Azure-Portal reachability ping. Graceful: camera/mic denial → "allow access" (hard block); everything else warns/adapts |
| OTP entry | ✅ (UI) | auto-advances fields |
| Booking + lobby | ✅ (UI) | lobby provisioning animates; **provisioning itself is simulated** — `// TODO(engine)` |
| **Assessment room** | ✅ | mock Azure Portal + the companion: **real countdown timer**, tickable objectives, Test-app, Submit-confirm modal, self-view with ● Recording + mic indicator |
| **Floating companion — real Document PiP** | ✅ progressive | "Pop out ↗" calls the real `documentPictureInPicture` API (copies stylesheets in); **docked fallback** when unsupported. Both paths render |
| Reflection + done | ✅ | fresh-rationale prompts; no score shown, ever |
| Verified | ✅ | `next build --webpack` green; typecheck clean; driven in-browser (consent gate, readiness 7-check run w/ real speed probe, room timer counting, test-app, submit modal, no crash) |

## 🔒 SIMULATED here — gated on owner cloud steps (the honest part)

Every backend seam is a `// TODO(engine)` stub. None of this can be truthfully built/tested
without the owner's cloud steps:

| Gated piece | Blocked on |
|-------------|-----------|
| Real candidate identity + Azure Portal sign-in | **A0 — dedicated labs Entra tenant** (owner one-time; candidates need Portal identities the corp tenant can't safely host) |
| Real environment provisioning (subscription/RG lease, warm pool, health gate) | A0 + **ent-engine Azure driver** (A1, not built) |
| Real invite email / OTP delivery at volume | **SES production access** (still denied — resubmit) |
| Recording capture + storage (snapshots + audio, 30-day retention) | build item; needs storage + the consent-copy finalized |
| Grading (final Azure state inspection, canary invoke) | ent-engine Azure driver + the Azure L2 scenario (A3) |
| Server-authoritative timer + exactly-once auto-submit | ent-engine session model (client timer is demo-only here) |

## Next build steps once A0 (Entra tenant) exists
1. ent-engine Azure driver (track:"azure" dispatch — lease = RG + minted candidate identity).
2. Candidate identity lifecycle (per-session member user → RG-scoped role → Portal → delete).
3. Wire this front-end's `TODO(engine)` seams to the real routes (provision poll, submit, grade).
4. Recording capture (snapshots + continuous audio) + storage + 30-day auto-delete.
5. Azure L2 "Harden the pipeline" scenario as real `lab.json` + grader.

See `ENTERPRISE-ASSESSMENT-DESIGN.md` (experience) + `ENTERPRISE-ASSESSMENT-CONTENT-PLAN.md`
§9b (Azure-first sequencing) for the full spec.

## Safety notes
- Route is hidden (noindex via layout default + explicit page override + robots disallow),
  unlinked from all nav — zero effect on the live landing / portal / admin / candidate-token
  surfaces.
- Nothing here touches the ent-engine, AWS, Azure, or any table — it's front-end only with
  simulated backend responses. Fully reversible (delete the `preview/` folder).
