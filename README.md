# ShieldSync Labs — Platform workspace (Phase 2)

The marketing site (`shieldsync-website/`) is the storefront. This folder is the **labs delivery platform** — the part that vends an AWS account, deploys a lab into it, hands the learner a real-console URL, and tears it all down.

> Nothing here is deployed yet — built offline-first per the do-not-host rule.

## Structure
```
labs-platform/
├── README.md
├── labs/                       # one folder per lab (the scenarios)
│   └── <slug>/
│       ├── lab.json            # metadata: name, level, objectives, success criteria
│       ├── template.yaml       # CloudFormation — what gets deployed in the user's sandbox
│       └── instructions.md     # learner-facing walkthrough (markdown)
├── engine/                     # (M6, later) the Session Engine — Lambda/Step Fn glue
├── app/                        # (M1, later) the labs.shieldsyncsecurity.com Next.js app
└── infra/                      # (M5, later) Innovation Sandbox config, SCPs, nuke config
```

## Per-lab contract (every lab MUST satisfy)
1. **One CloudFormation template** — `template.yaml`, region-agnostic (us-east-1 default).
2. **All resources tagged** `ShieldSyncLab=<slug>` so aws-nuke can target them safely.
3. **DeletionPolicy: Delete** on every resource — no orphans on stack teardown.
4. **Stack outputs** — the Session Engine reads these to render the learner instructions (bucket names, IAM creds, console deep-link, etc.).
5. **Cost target** under the buffered planning cost in `Labs-Business-Plan.md` (Beginner ≤ ₹15, Intermediate ≤ ₹75, Advanced ≤ ₹350).
6. **No NAT Gateway, no EKS, no instances >2 vCPU.** Enforced by SCP at the org level too.
7. **Self-contained.** No cross-lab dependencies. Each lab's stack stands alone.

## Lab status

| Lab slug | Level | Status |
|---|---|---|
| `s3-misconfiguration-audit` | Beginner (free) | ✅ template + lab.json + instructions |
| `iam-privilege-escalation` | Intermediate | ✅ template + lab.json + instructions |
| `kms-data-protection` | Beginner | ⏳ pending |
| `guardduty-security-hub-triage` | Intermediate | ⏳ pending |
| `cloudtrail-forensics` | Advanced | ⏳ pending |
| `vpc-network-exposure` | Intermediate | ⏳ pending |

SOC labs (SIEM/SOAR) use Fargate containers, not CloudFormation — separate sub-folder when their pattern is decided.

## How a lab runs (end-to-end, once M5+M6 exist)
1. User clicks **Start lab** in the app (`labs.shieldsyncsecurity.com`).
2. Session Engine checks entitlement + concurrency.
3. **Innovation Sandbox** leases a clean account from the pool.
4. Engine deploys `labs/<slug>/template.yaml` into that account (`aws cloudformation deploy`).
5. Engine mints a federated console sign-in URL (STS AssumeRole into a learner role created by the template).
6. User lands in the **real AWS console**, working only in that sandbox.
7. On expiry / completion → ISB freezes account → aws-nuke wipes everything → account returns to pool.
