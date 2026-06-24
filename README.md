# ShieldSync Labs — Platform workspace

The marketing site (`shieldsync-website/`) is the storefront. This folder is the
**labs delivery platform** — it vends a throwaway AWS account, deploys a lab into it,
hands the learner a real-console URL, and tears it all down.

> **🟢 LIVE** at `labs.shieldsyncsecurity.com`. Auth (Cognito + Google), the Session
> Engine, lab launch/teardown, auto-grader, wait-room queue, and admin ratings are all
> deployed and verified. **For current operational state, deploy steps, env/secrets, and
> gotchas, read [`AUTH_AND_DEPLOY_RUNBOOK.md`](./AUTH_AND_DEPLOY_RUNBOOK.md) first** —
> this README is just the workspace map + the per-lab contract.

## Structure
```
labs-platform/
├── README.md
├── AUTH_AND_DEPLOY_RUNBOOK.md   # ← operational source of truth (read first)
├── H3-LAUNCH-ATOMICITY-SPEC.md  # per-user launch-lock design (implemented)
├── labs/                        # one folder per lab (the scenarios)
│   └── <slug>/
│       ├── lab.json             # metadata: name, level, objectives, successCriteria
│       ├── template.yaml        # CloudFormation — what gets deployed in the sandbox
│       └── instructions.md      # learner-facing walkthrough (markdown)
├── engine/                      # the Session Engine — Lambda (handler.mjs + labinfra.mjs
│                                #   + graders.mjs) deployed via deploy/deploy.ps1; dev/test
│                                #   helpers (load-test-waitroom, demo-waitroom, try-*)
├── app/                         # the labs.shieldsyncsecurity.com Next.js app (Cloudflare Worker)
└── infra/                       # SCPs + aws-nuke config (reference; teardown generates per-acct)
```

> **Vending is DIY, not Innovation Sandbox.** We build the Session Engine *as* the
> vending/isolation/cleanup control plane on free AWS primitives (Organizations + SCPs +
> STS federation + AWS Budgets + aws-nuke + DynamoDB), and **Cognito** (not Clerk) for
> auth. The `ISB/` clone is reference only — not used at runtime.

## Per-lab contract (every lab MUST satisfy)
1. **One CloudFormation template** — `template.yaml`, region-agnostic (us-east-1 default).
2. **All resources tagged** `ShieldSyncLab=<slug>` so aws-nuke can target them safely.
3. **DeletionPolicy: Delete** on every resource — no orphans on stack teardown.
4. **Stack outputs** — the engine reads these to render the learner instructions.
5. **Cost target** under the buffered planning cost in `Labs-Business-Plan.md`.
6. **No NAT Gateway, no EKS, no instances >2 vCPU.** Enforced by SCP at the org level too.
7. **Self-contained.** No cross-lab dependencies. Each lab's stack stands alone.
8. **Auto-grader (standing rule):** every lab MUST ship a working grader — `successCriteria`
   in `lab.json` + a `gradeXxx()` in `engine/graders.mjs` (added to `deploy.ps1`'s zip line).
   A lab without one is not "done". Verify fresh-fails / remediated-passes before `ready:true`.

## Lab status

**Catalogue = 2 labs, both live + graded.** (The 4 not-ready labs — kms, guardduty,
cloudtrail, vpc — were **deleted 2026-06-22**; new lab content is the owner's to design.)

| Lab slug | Level | Status |
|---|---|---|
| `s3-misconfiguration-audit` | Beginner (free) | 🟢 live — template + lab.json + instructions + grader |
| `iam-privilege-escalation` | Intermediate (paid) | 🟢 live — template + lab.json + instructions + grader |

SOC labs (SIEM/SOAR) are a separate, not-yet-built program (Wazuh-based, container-served).

## How a lab runs (end-to-end — DEPLOYED)
1. User clicks **Launch** in the app (signed in via Cognito/Google; entitlement + launch-cap gated).
2. Engine `/launch`: acquires an atomic per-user lock (H3) → checks rate cap → free-pool cap
   (else 503 + wait-room queue) → leases a clean sandbox account (warm pool when available).
3. Engine deploys `labs/<slug>/template.yaml` into that account (`aws cloudformation deploy`),
   or reuses a pre-warmed stack.
4. Engine mints a federated **real AWS console** sign-in URL (STS AssumeRole into the learner
   role), time-boxed to the session window.
5. Learner works in the sandbox; "Check my work" grades live account state vs `successCriteria`.
6. On expiry / End / sign-out → **aws-nuke** wipes the account → it returns to the pool.
   EventBridge `ShieldSyncReaper` sweeps abandoned sessions; `ShieldSyncWarmer` pre-stages the pool.
