# Ship checklist — enterprise fixes (2026-07-30)

One deploy pass ships everything built this session. All changes are code-complete
on branch `hr-candidates-and-go-live`; **nothing is live yet** (deploy runs from the
working tree, so a commit isn't required first — but commit when convenient).

---

## What you're shipping

| # | Change | Why it matters |
|---|--------|----------------|
| 1 | **`ShieldSyncEntMembers` added to the engine IAM policy** | Launch-blocker. `getMember` runs on every employer login and `putMember` binds seats — both hit this table. If the deployed role matched the old file, onboarding + sign-in were failing on AccessDenied. |
| 2 | **Submit data-loss fix** | The stored result is now the source of truth for "already graded", so a lost status-write can't let a retry overwrite a real grade with a zero. |
| 3 | **Recording presigner bundled** (+ npm install) | `@aws-sdk/s3-request-presigner` isn't reliably in the Lambda runtime; without it every recording upload 500s. |
| 4 | **SDK-dependency deploy guard** | Refuses to deploy if a non-client `@aws-sdk` import isn't declared — prevents #3's bug class from recurring. Runs automatically. |
| 5 | **Prod mock gated** | `/preview/candidate` (fabricated data) now 404s unless `ALLOW_PREVIEW_MOCKS=1`. One real path to the candidate flow. |
| 6 | **Provision-login admin action** | "Provision login" in `/admin` creates the Cognito user + binds the seat in one click — no more AWS-console step. |

---

## Step 1 — one manual edit before deploying (only if enabling #6)

Add this to `engine/deploy/policy-ent.json` `Statement` array and replace the pool id
with your real one (the `COGNITO_POOL_ID` value, e.g. `us-east-1_Abc123`):

```json
{
  "Sid": "CognitoProvisionEmployerLogins",
  "Effect": "Allow",
  "Action": ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"],
  "Resource": "arn:aws:cognito-idp:us-east-1:750294427884:userpool/REPLACE_WITH_POOL_ID"
}
```

Skip this only if you're not turning on the provision button yet — everything else
deploys fine without it (the button just returns an error until the grant exists).

---

## Step 2 — deploy the engine (platform acct 750)

```
cd labs-platform/engine
npm install
.\deploy\deploy-ent.ps1
```

`npm install` pulls the presigner (#3). The deploy runs two guards before shipping —
import-closure and the new sdk-dependency check; if either refuses it names exactly
what's missing. This step applies: the Members IAM fix, the Cognito grant, the
data-loss fix, the presigner, and the provision endpoint.

---

## Step 3 — deploy the Worker

```
cd ../enterprise
npm run build
npm run cf:deploy
```

`npm run build` is your pre-deploy gate — it must be clean (a bad build silently
blocks CI). Ships the prod-mock gate (#5) and the provision-login UI + route (#6).

---

## Step 4 — verify (about 5 minutes)

- [ ] **Recording (#3):** run one assessment with camera on -> engine logs show no
      `Cannot find package '@aws-sdk/s3-request-presigner'`; snapshots land in the S3
      recordings bucket.
- [ ] **Employer login (#1):** an existing employer opens their portal — confirms the
      Members IAM fix works (this is the launch-blocker verification).
- [ ] **Provision (#6):** `/admin` -> an org -> "Provision login" with a test email ->
      Cognito user created, seat appears, the test user can sign in. If it returns
      `PROVISION_UNAVAILABLE`, the runtime lacks `@aws-sdk/client-cognito-identity-provider`
      — bundle it the same way as the presigner (unlikely; it's a core client).
- [ ] **Work timeline:** open a completed candidate report -> the debrief/timeline
      populates. If it says "unavailable", the runtime lacks `@aws-sdk/client-cloudtrail`
      — this fails safe, so bundle it when convenient (not a blocker).

---

## Still yours — NOT shipped by this deploy (launch-gated)

These are decisions/credentials only you can supply:

- Prod secrets present on the Worker: `COGNITO_CLIENT_SECRET`, `SESSION_SECRET`, `ENT_ENGINE_SECRET`.
- Resend plan — OTP shares a 100/day free-tier email cap.
- `LAB_VARIANCE=1` decision (per-candidate scenario rotation) + variant-fairness check.
- Azure track end-to-end live-test / Entra Graph admin consent.
- MFA enforcement, `SHIELDSYNC_GSTIN`/address env, agreement legal-text review.

---

## After this ships — next code work

- **Report delivery**: email the candidate their report link + notify the employer on
  submit (currently pull-only). Depends on the Resend plan above.
- **Employer invoice download**: the GST tax-invoice view exists on the staff side only;
  add a download link to the employer billing page.
