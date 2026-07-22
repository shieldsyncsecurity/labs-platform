# ShieldSync HR portal — go-live runbook

Internal, allowlist-only HR portal at **employee.shieldsyncsecurity.com** (owner + EA).
Everything below is **held until you approve** — steps 1 and 6 create billable AWS/Cloudflare
resources. Local dev needs none of it (see the bottom).

## 0. Prereqs
- The two mailboxes must exist and be reachable: `admin@shieldsyncsecurity.com`, `hr@shieldsyncsecurity.com`.
- AWS CLI logged in with access to assume `OrganizationAccountAccessRole` in platform account `750294427884`.
- **Dev-data hygiene:** local dev stores data unencrypted in `%TEMP%`. Before go-live, purge it —
  ```powershell
  Remove-Item -Recurse -Force "$env:TEMP\shieldsync-hr-kyc","$env:TEMP\shieldsync-hr-dev-store.json" -ErrorAction SilentlyContinue
  ```
  and keep only **synthetic** data in dev from now on (never real Aadhaar/PAN scans).

## 1. Provision the isolated AWS data plane (billable) — run from `engine/`
```powershell
node create-hr-tables.mjs          # 3 HR tables + id counter + SSS/HR/2026 ref counter (seeded at 014), PITR on
node create-hr-kyc-infra.mjs       # dedicated KMS CMK + KYC bucket (SSE-KMS, block-public, versioning,
                                   # 30-day noncurrent-version expiry) + SSE-KMS on all 3 tables; patches policy-hr.json
$env:HR_ENGINE_SECRET = "<long random, 32+ chars — the script offers a generated one>"
$env:RESEND_API_KEY   = "<Resend key>"          # for emailing documents (optional but recommended)
$env:HR_MAIL_FROM     = "ShieldSync HR <hr@shieldsyncsecurity.com>"
.\deploy\deploy-hr.ps1             # Lambda + API GW (throttled) + log retention + SMOKE TEST; prints HR_ENGINE_URL
```

## 2. Wire the Worker — run from `hr/`
- Put the printed `HR_ENGINE_URL` into `hr/wrangler.jsonc` → `vars.HR_ENGINE_URL`.
- Set the three Worker secrets:
```powershell
npx wrangler secret put HR_ENGINE_SECRET       # must EQUAL the Lambda's value from step 1
npx wrangler secret put HR_SESSION_SECRET       # a fresh long random string (independent of enterprise)
npx wrangler secret put COGNITO_CLIENT_SECRET   # the HR app-client secret (step 3)
```

## 3. Cognito (pool `us-east-1_54vIGJe4R`)
- **Create a DEDICATED app client for HR** (don't reuse the enterprise client — separate secret,
  separate callback list, no cross-app blast radius). Allowed URLs:
  - Callback: `https://employee.shieldsyncsecurity.com/api/auth/callback`
  - Sign-out: `https://employee.shieldsyncsecurity.com`
  Then put its id in `hr/wrangler.jsonc` → `COGNITO_CLIENT_ID` and its secret in the Worker secret above.
- Create the two users with `email_verified = true`: `admin@shieldsyncsecurity.com`, `hr@shieldsyncsecurity.com`.
- **Enable MFA for both** (pool MFA = OPTIONAL so the enterprise app is untouched; enroll software
  TOTP for just these two users — `admin-set-user-mfa-preference`). One phished password must not
  unlock the KYC store.
- `HR_ALLOWLIST` is already these two emails (wrangler.jsonc). Everyone else is denied.

## 4. DNS
- Add `employee.shieldsyncsecurity.com` as a Cloudflare custom domain bound to the `shieldsync-hr` Worker.

## 5. Deploy (billable) — run from `hr/`
```powershell
npm run cf:deploy      # opennextjs-cloudflare build (webpack) + wrangler deploy
```

## 6. Verify (all of these, not just the happy path)
1. Sign in as `admin@` → add a **test** employee → generate letter + payslip → upload/download/delete a KYC doc → audit shows each action.
2. **Deny test:** sign in with a third, non-allowlisted Cognito user → must be refused (`no_access`). The allowlist IS the authorization model — prove it.
3. **Asset gate:** `curl -I https://employee.shieldsyncsecurity.com/sealed/authorised-signature.png` logged **out** → must NOT be 200 (the signature/seal are gated; only `/brand/cipher-s-mark.png` is public).
4. **Large file:** upload a ~3.9 MB PDF (should succeed) and confirm a >4 MB file is refused with a clear message.
5. **Erasure is real:** upload + delete a KYC doc, then in the S3 console list VERSIONS for its key — no versions may remain.
6. **Restore drill (once):** PITR-restore `ShieldSyncHrEmployees` to a temp table, confirm rows, delete the temp table.
7. **Email:** send a test document to yourself via the Email button; confirm receipt + the `doc.email` audit entry + the archived copy.

## Rollback
- Worker: `npx wrangler rollback` (or redeploy the previous build).
- Engine: `.\deploy\deploy-hr.ps1` from the previous git commit of `hr-handler.mjs` (single-file Lambda; state lives in DynamoDB/S3 and is untouched by code rollback).

---

## Data-protection posture (stated policy)
- **Purpose:** employment records — offer/appointment, payroll, statutory compliance, and KYC of
  ShieldSync Security Private Limited employees. Access limited to the owner + EA (2 accounts, MFA).
- **Retention:** records are retained for the life of the company **until manually erased by the
  owner** (owner's decision, 2026-07-22). Deletion is a deliberate, audited HR action and is REAL:
  all S3 object versions are purged, and DynamoDB rows removed. Note: Indian payroll law expects
  wage records kept ~3 years and income-tax records ~8 years — do not erase an ex-employee's payroll
  history before that.
- **Breach SOP (DPDP s.8(6)):** if compromise of KYC/employee data is suspected — (1) revoke the
  Worker secrets + rotate `HR_ENGINE_SECRET`; (2) if key compromise is suspected, disable the CMK
  `alias/shieldsync-hr-kyc` (KMS → key → Disable; this instantly makes ALL KYC unreadable — the
  kill-switch); (3) export the audit log (Audit → Export CSV) as evidence; (4) assess scope from
  `kyc.download` / `audit` entries; (5) notify affected data principals and the Data Protection
  Board as required (detailed report within 72 hours); (6) re-enable/rotate keys after containment.
- **Audit:** every create/edit/exit/delete, KYC upload/download/delete, document issue/email, and
  audit export is logged with the actor. The audit table is append-only at the IAM boundary.

---

## Local development (no AWS, no cost)
```powershell
# terminal 1 — the dev data plane (file store in %TEMP%; SYNTHETIC data only)
node engine/hr-server.mjs
# terminal 2 — the app
cd hr; npm run dev        # http://localhost:3003  (dev sign-in enabled via HR_DEV_LOGIN)
```
`hr/.env.local` points the app at `http://localhost:4002`. The dev engine mirrors the exact
`/hr/*` contract the Lambda serves. Email sends are SIMULATED in dev unless `RESEND_API_KEY` is set.
Run the payslip/letters unit tests with `npm test` (in `hr/`).
