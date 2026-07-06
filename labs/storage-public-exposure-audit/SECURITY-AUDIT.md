# SECURITY AUDIT — `storage-public-exposure-audit` (Azure lab)

Adversarial review of every authored file for the first free Azure lab. Scope of the
audit is the six security questions posed by the reviewer brief:

1. Is `learnerRole` genuinely least-privilege and RG-scoped? Can a learner escalate?
2. Do the `denyDelete` lock + no-subscription-scope + Azure Policy actually bound blast radius?
3. Does teardown truly revoke access and leave no orphan?
4. Is cost bounded to ~0 and un-inflatable by the learner?
5. Any secrets in source? Is the seeded data non-sensitive dummy?
6. Can the data-plane probe be gamed?

**Verdict: CONCERNS.** The security *design* is sound and genuinely least-privilege, but
there is **one release-blocking functional bug** (`mintAccess` never applies the audited
permissions — it reads mis-cased keys and mints an **empty** role) plus several data-plane
probe and teardown robustness gaps. No secrets in source. No privilege-escalation path found
in the role as *specified*; the role as *actually minted* is empty (fail-closed).

## Resolution (applied after this audit)
- **#1 BLOCKER (minted role empty):** ✅ fixed — `mintAccess()` reads `learnerRole.permissions[0].*` (`engine/azure-infra.mjs` ~L376–394). The audited least-privilege role is now the one that ships.
- **#2 HIGH (orphan role *definition*):** ✅ fixed — `teardown()` deletes the custom role definition via a threaded `roleDefId`, absence-tolerant (~L456–469).
- **#3 HIGH (probe "any non-200 = blocked"):** ✅ fixed — grader scores `200`=leaking, `403/409`=blocked, `5xx/404/other`=`unknown` (`engine/graders.azure.mjs` ~L106–128).
- **#4 MEDIUM (deny-delete fallback unguarded):** ✅ fixed — `deploy()` throws in `NODE_ENV=production` unless `ALLOW_NO_STACK=1` (~L206).
- **#5 MEDIUM (deny-policy VM-size alias):** ⏸ deferred — harmless for this storage-only lab (learner has zero compute RBAC); fix the `hardwareProfile.vmSize` alias before any compute lab reuses `deny-expensive-policy.json`.
- **#6 LOW (doc/comment polish):** ✅ done — `assignableScopes`-override comment + synthetic-data comment present.
- **Extra (found on final review):** mgmt SP now granted **Storage Blob Data Contributor** per pool RG in `setup-landing-zone.ps1` (seedBlob AAD upload).

The sections below describe the PRE-FIX state (retained as the audit of record).

Files reviewed:
- `labs/storage-public-exposure-audit/main.bicep`
- `labs/storage-public-exposure-audit/lab.json` (engine copy, has `learnerRole`)
- `app/content/labs/storage-public-exposure-audit/lab.json` (app copy)
- `app/content/labs/storage-public-exposure-audit/instructions.md`
- `engine/graders.azure.mjs`
- `engine/azure-infra.mjs`
- `engine/try-azure-lab.mjs`
- `infra/azure/{README.md, deny-expensive-policy.json, setup-landing-zone.ps1}`

All `.mjs` pass `node --check`; all JSON parses.

---

## 1. learnerRole — least-privilege & RG-scoped?

### The 11 grants, justified against the 3 remediations

| Action / DataAction | Needed for | Verdict |
|---|---|---|
| `…/resourceGroups/read` | Portal RG blade navigation | OK, read-only |
| `Storage/storageAccounts/read` | See the account + its flags (all 3 criteria) | OK |
| `Storage/storageAccounts/write` | Flip `allowBlobPublicAccess`, `supportsHttpsTrafficOnly`, `minimumTlsVersion` (Flaws A/B/C) | **Required** for all 3 fixes; scoped to RG |
| `…/blobServices/read` + `…/blobServices/write` | Blob-service-level properties | OK; not strictly needed for these 3 fixes (see note) |
| `…/blobServices/containers/read` + `…/containers/write` | Reset `public-data` container `publicAccess` to `None` (belt-and-braces for criterion 1) | **Required** for the container remediation |
| `Authorization/roleAssignments/read` + `roleDefinitions/read` | Console IAM-blade navigation (mirrors the S3 lab's `iam:ListUsers`) | OK, read-only |
| **DataAction** `…/containers/blobs/read` | Let the learner reason about / re-download the blob to prove the leak | OK — read only |

### Escalation analysis — can a learner with this role…

- **Grant themselves more?** No. There is **no** `Microsoft.Authorization/*/write` (no
  `roleAssignments/write`, no `roleDefinitions/write`). They can *read* role defs/assignments
  but cannot create or modify them. ✅
- **Touch other RGs / subscriptions?** No. `assignableScopes` is a single RG and the
  engine assigns at RG scope. No subscription-scope action is present. Even
  `storageAccounts/read` is bounded by the assignment scope. ✅
- **Read keys / SAS?** No. There is **no** `…/storageAccounts/listKeys/action`,
  `…/listAccountSas/action`, or `…/listServiceSas/action`. The learner cannot mint a SAS or
  pull the account key, so they cannot bypass the very controls they are fixing. ✅
  (Note: `storageAccounts/write` does **not** implicitly grant `listKeys` in Azure RBAC —
  key-listing is a distinct action — so this is genuinely closed.)
- **Delete the scenario?** No. There is **no** `*/delete` of any kind. Container-delete and
  account-delete are separate RBAC actions (`…/containers/delete`,
  `…/storageAccounts/delete`) and neither is granted. The learner literally cannot delete
  their way to a green grade. ✅ (The `denyDelete` stack lock is therefore defense-in-depth
  on top of an already delete-less role — good.)
- **Reach Entra / tenant?** No. No `Microsoft.Graph`/AAD actions, no directory scope. ✅

**Least-privilege conclusion:** the role *as specified in `lab.json`* is tight and correct —
arguably it could drop `blobServices/read|write` (the 3 graded fixes are account-level +
container-level, not blob-service-level), but including them is harmless and keeps the portal
Data-storage blades navigable. **No escalation path in the specified role.**

### 🔴 BLOCKER — the minted role is EMPTY (permissions never applied)

`engine/azure-infra.mjs` → `mintAccess()` builds the custom role like this:

```js
permissions: [{
  actions:        learnerRole.Actions        ?? [],
  notActions:     learnerRole.NotActions      ?? [],
  dataActions:    learnerRole.DataActions     ?? [],
  notDataActions: learnerRole.NotDataActions  ?? [],
}]
```

But `lab.json` stores the grant **nested and lower-cased**:

```json
"learnerRole": { "permissions": [ { "actions": [...], "dataActions": [...] } ] }
```

`learnerRole.Actions` / `.DataActions` (capitalised, top-level) are **`undefined`**, so every
array falls back to `[]`. **The custom role is created with zero actions and zero
dataActions.** Consequences:

- The learner is assigned a role that grants **nothing** → they cannot open the account, read
  flags, or remediate. The lab is unusable through the intended access path.
- The carefully-audited least-privilege object is **never actually enforced** — what protects
  the blast radius in practice is the RG scope + the deny-policy + the mgmt SP's own scoping,
  *not* this role.

This is **fail-closed** (empty = no access, not over-access), so it is not itself an
escalation, but it is a release blocker: the security model on paper is not the security model
that ships. **Fix:** read from `learnerRole.permissions[0]` (and match the lower-case keys),
e.g.:

```js
const perm = (learnerRole.permissions && learnerRole.permissions[0]) || {};
permissions: [{
  actions: perm.actions ?? [], notActions: perm.notActions ?? [],
  dataActions: perm.dataActions ?? [], notDataActions: perm.notDataActions ?? [],
}]
```

### 🟠 Note — `assignableScopes` placeholder is silently ignored (mostly OK)

`lab.json.learnerRole.assignableScopes` is `["/subscriptions/<SUB_ID>/resourceGroups/<RG>"]`.
`mintAccess` **ignores** this field and constructs its own `rgScope` from `subscriptionId()` +
`resourceGroup`, then sets `assignableScopes: [rgScope]`. That is the correct, safe behaviour
(the placeholder never leaks into a real role). But it means the `<SUB_ID>/<RG>` placeholder in
`lab.json` is decorative. Low severity — flag it so no one later "fixes" the placeholder
thinking it is load-bearing. Recommend a one-line comment in the code noting the field is
overridden at mint-time.

---

## 2. Blast-radius bounding (denyDelete + no-sub-scope + Azure Policy)

### denyDelete Deployment Stack — correct choice, with one caveat

- `denySettings.mode = "denyDelete"` (not `denyWriteAndDelete`) is **correct**: the learner
  must be able to *write* (flip the flags) to remediate; `denyWriteAndDelete` would block the
  remediation itself. The code comment reasons about this correctly.
- `applyToChildScopes: true` extends the deny-delete to child resources (blob service,
  container) — good, stops "delete the container to pass."
- `actionOnUnmanage: { resources: delete, resourceGroups: delete, managementGroups: delete }`
  ensures teardown removes everything the stack manages.

🟠 **Caveat — the fallback path drops the guard silently.** If the installed
`@azure/arm-resources` lacks `deploymentStacks`, `deploy()` falls back to a plain
`deployments.beginCreateOrUpdateAndWait` with **no deny-delete assignment**. It is logged as a
`console.warn`, but in that mode the learner could delete the scenario. Because the *learner
role itself has no delete action* (Section 1), the practical exposure is low — but if the role
bug above is ever "fixed" by granting broader Storage permissions (e.g. a Contributor-style
`storageAccounts/*`), the fallback would then permit scenario deletion. **Recommend** the
fallback either (a) refuse to run in prod (throw unless an `ALLOW_NO_STACK=1` escape hatch is
set) or (b) be gated behind a config flag, so a missing SDK feature can't quietly weaken the
guard. Defense-in-depth should not depend on the role staying delete-less forever.

### No subscription scope — confirmed

- The learner role's only scope is the session RG (Section 1). ✅
- The **mgmt SP** (setup-landing-zone.ps1) is `Contributor` **per pool-RG**, never
  subscription-wide, and `Role Based Access Control Administrator` is **conditioned** so it can
  only ever assign the one learner role (the ABAC condition pins
  `roleAssignments:RoleDefinitionId ForAnyOfAnyValues:GuidEquals {learnerRoleId}`). A
  compromised mgmt SP therefore cannot hand out Owner/Contributor. ✅ Strong design.
- The **probe SP** is `Reader` per pool-RG — cannot list keys, cannot read blob data, cannot
  mutate. A leaked probe secret is inert. ✅

🟡 **Caveat on the RBAC-Admin condition:** the condition guards `roleAssignments/write`, but
the mgmt SP also needs to *create the custom role definition* per lease
(`mintAccess → roleDefinitions.createOrUpdate` at RG scope). `Role Based Access Control
Administrator` **does** include `roleDefinitions/write`, and that is **not** constrained by the
condition (the condition only matches the `roleAssignments/write` action). So a compromised
mgmt SP could author an arbitrary **custom role definition** scoped to a pool RG and assign…
no — assignment is still condition-limited to the single learner-role GUID, so it could create
a powerful definition but **not assign it**. Net: still bounded, but worth documenting that the
role-*definition* write is unconstrained within the pool RGs. Low/medium.

### Azure Policy deny fence — solid, two small gaps

`deny-expensive-policy.json` denies large VMs, VMSS, AKS, all managed DBs, costly networking,
Redis/Synapse/HDInsight/Cognitive, and locks location to `eastus`. Assigned at subscription
scope. Good coverage. Adversarial gaps:

- 🟡 **VM SKU field alias.** The rule keys VM size on
  `Microsoft.Compute/virtualMachines/sku.name`. Azure VMs actually carry size under
  `properties.hardwareProfile.vmSize`, **not** a top-level `sku.name` (that alias is used by
  VMSS / disks, not by `Microsoft.Compute/virtualMachines`). As written, the "VMs above tiny
  tier" clause likely **never matches**, so a learner (if they had compute permissions — they
  do **not** here) could deploy any VM size in `eastus`. For *this* storage-only lab the
  learner role grants no compute at all, so exposure is nil, but the fence is weaker than it
  reads. **Fix:** match on `Microsoft.Compute/virtualMachines/sku.name` **and/or**
  `Microsoft.Compute/virtualMachines/hardwareProfile.vmSize` (verify the exact alias) before
  relying on this for a compute lab.
- 🟡 **No Storage SKU cap.** Storage is (correctly) not denied, but nothing caps the SKU/tier.
  The learner role's `storageAccounts/write` is on the *existing* account only in spirit, but
  RBAC `storageAccounts/write` at RG scope also allows **creating new** storage accounts in the
  RG. A malicious learner could create additional Standard_LRS accounts or flip the existing
  one to `Premium` / add large blobs. Cost is still bounded by data volume (see Section 4), but
  it is not strictly "one account." Low severity for cost; note for tidiness.

---

## 3. Teardown — revokes access, no orphans?

`teardown()` deletes the Deployment Stack (`unmanageActionResources: delete`) then
`resourceGroups.beginDeleteAndWait(rg)`. RG-delete is the authoritative wipe. Absence-tolerant
(404 / *NotFound → success). Good.

What gets cleaned:
- **Scenario resources** (account, blob service, container): deleted with the RG. ✅
- **Seed blob** (`customer-export.csv`, out-of-band, not stack-managed): deleted with the RG. ✅
- **Custom role assignment** (`mintAccess` created it at RG scope): a role **assignment**
  scoped to the RG is deleted when the RG is deleted. ✅

### 🟠 Orphan — the custom role DEFINITION is not deleted

`mintAccess()` creates a **custom role *definition*** via
`roleDefinitions.createOrUpdate(rgScope, roleDefId, …)` with `assignableScopes:[rgScope]`.
Role **definitions** are subscription-level objects (their `id` lives under
`/subscriptions/…/providers/Microsoft.Authorization/roleDefinitions/<guid>`), **not** child
resources of the RG. Deleting the RG deletes the *assignment* but can **leave the definition
orphaned** at the subscription. Over many sessions this accumulates
`ShieldSyncLabLearner-<rg>` definitions (each RG name is unique), cluttering the tenant and
tripping the ~5,000 custom-role-definitions-per-tenant limit eventually. **Teardown never
calls `roleDefinitions.delete`.** Because the definition's `assignableScopes` points at a
now-deleted RG, it is inert (cannot be assigned anywhere real), so it is **not a security
exposure** — but it is a genuine **orphan / resource-leak**. **Fix:** in `teardown()`, before
or after the RG delete, call
`authClient().roleDefinitions.delete(rgScope, roleDefId)` (thread `roleDefId`/definition id
through ctx), absence-tolerant like the rest.

### 🟡 Access revocation timing

Deleting the RG removes the assignment, which revokes the learner's standing access. But any
**already-issued ARM token** the learner holds remains technically valid until expiry (Azure
AD access tokens ~60–90 min); the learner just has nothing left to act on (RG gone). This is
normal Azure behaviour and acceptable — noting for completeness, not a defect.

---

## 4. Cost — bounded to ~0, un-inflatable by the learner?

- Bicep deploys **one** `Standard_LRS` `StorageV2` account + a few-KB CSV blob. No compute, no
  VM, no public IP, no egress at idle. Deployment Stacks are free. ✅
- Teardown deletes the RG → nothing bills after a session. ✅
- Deny-policy blocks the expensive escapes (VMs caveat aside — and the learner has no compute
  RBAC anyway). ✅
- 🟡 **Learner-driven inflation, bounded but non-zero.** With `storageAccounts/write` +
  `containers/write` + `blobs/read` at RG scope, the learner **cannot** upload arbitrary
  blobs (no `blobs/write` DataAction) — so they cannot fill the account with data over the
  data plane using this role. ✅ They *could* create additional empty storage accounts
  (control-plane `storageAccounts/write` in the RG), but empty Standard_LRS accounts cost ~₹0
  at idle, and the `idleAutoStopMinutes: 30` + `accessWindowHours: 24` + teardown bound the
  window. Net cost stays ≈₹0. **No practical inflation vector.** ✅

Cost verdict: **bounded to ~0.** The absence of a `blobs/write` DataAction is what makes it
un-inflatable — good that it was omitted.

---

## 5. Secrets in source & seeded-data sensitivity

- 🟢 **No secrets in any committed file.** Grepped the SP/credential flow:
  `azure-infra.mjs` uses `DefaultAzureCredential` (env / MI / az-login) — no hard-coded keys.
  `setup-landing-zone.ps1` **generates** SP secrets at runtime and prints them once with an
  explicit "do NOT commit them" warning; nothing is written to a tracked file. README repeats
  the store-in-secret-manager guidance. ✅
- 🟢 **Seeded blob is obviously-fake dummy data.** `seedBlob()` writes a 3-row CSV of
  `example.com` addresses and `4242`/`1881`/`9004` "card_last4" values — no real PII, no real
  card numbers, no credentials. The "secret" is pedagogical. ✅
- 🟢 **Anonymous blob URL is non-sensitive.** It points at the intentionally-public seed CSV;
  exposing it *is the lesson*. No token/SAS is embedded in the URL (it is a bare
  `https://<acct>.blob.core.windows.net/public-data/customer-export.csv`). ✅
- 🟡 Minor: the seed CSV uses a plausible-looking `card_last4` column. It is fake, but if a
  scanner ever flags "card data" in a public blob, that is by design — worth a one-line comment
  in `seedBlob()` that the data is synthetic, to preempt false-positive DLP alarms in the
  sandbox subscription.

---

## 6. Can the data-plane probe be gamed?

Criterion 1 passes iff `allowPublic === false` **AND** `anonBlocked`, where
`anonBlocked = anonStatus != null && anonStatus !== 200`. The `fetch` is unauthenticated with
`redirect: "manual"`. Adversarial analysis:

- 🟢 **Cannot pass while still leaking.** To get `allowPublic === false` the learner must
  actually flip the account flag (control-plane read via `getProperties`), and *that flag being
  false is what returns 409 to anonymous callers*. So a learner cannot pass criterion 1 while
  the blob is still anonymously readable — the two conditions are ANDed and mutually
  reinforcing. The design goal (data-plane proof, not just control-plane) is met. ✅

- 🟠 **`anonStatus !== 200` is too permissive — 4xx/3xx/5xx all count as "blocked."**
  - A **404** (learner renamed/deleted the container, or the seed blob was never uploaded, or
    the grader was handed a stale/typo'd `anonymousBlobUrl`) is scored as "blocked." Combined
    with `allowPublic === false`, a learner who *disabled the flag but left an unrelated 404*
    still passes — acceptable here (flag is false = leak closed) but it means the probe is not
    really proving *this blob* is unreadable, only that *this URL* isn't 200.
  - A **5xx / 503** transient from the storage front-end would read as "blocked" and could
    yield a **false pass** in the narrow window where the account flag is already false. Low
    probability, but a throttled/erroring endpoint should be `unknown`, not "blocked."
  - **Recommendation:** tighten to treat only the *expected* closed-state codes as a pass —
    i.e. `403`/`409` (PublicAccessNotPermitted) → blocked; `200` → still leaking (fail);
    `5xx`/network → `unknown` (already handled for network throws, but not for 5xx *responses*);
    optionally verify the 409 body contains `PublicAccessNotPermitted`. A `404` should arguably
    be `unknown` (we can't prove the control worked if the target vanished) rather than a silent
    pass.

- 🟢 **Redirect suppression is correct.** `redirect: "manual"` means a learner cannot dodge the
  check by configuring a redirect to a 200 elsewhere — a 3xx is not 200 and (post-fix above)
  should be treated as non-authoritative. Good instinct including it.

- 🟢 **No auth header** — the request is exactly the anonymous-attacker request. Correct. ✅

- 🟢 **Grader identity cannot be abused.** The probe uses `fetch()` with no credential, and the
  control-plane read uses the read-only probe SP. Even if the grading path were compromised it
  cannot mutate the learner env. ✅

Probe verdict: **not gameable into a leaking pass**, but the "any non-200 = blocked" rule
should be tightened so transient 5xx / vanished-target 404 don't count as determinate passes.

---

## Cross-file consistency checks (passed)

- Slug, title, track (`azure`), tags, timings, `estimatedAzureCostInr`, region **match**
  across engine `lab.json`, app `lab.json`, Bicep, grader, and infra. ✅
- App `lab.json` correctly **omits** `learnerRole` / `_learnerRole` (no role leakage to the
  browser bundle). ✅
- successCriteria ids (`no-anonymous-blob-access`, `secure-transfer-required`,
  `minimum-tls-1-2`) are **identical** in both `lab.json`s and the grader return ids and the
  `try-azure-lab.mjs` `EXPECTED_IDS`. ✅ (Load-bearing — verified.)
- `enableHttpsTrafficOnly` (grader/remediate) vs `supportsHttpsTrafficOnly` (Bicep/spec prose):
  **consistent and correct** — `supportsHttpsTrafficOnly` is the ARM/Bicep property; the
  `@azure/arm-storage` SDK surfaces it as `enableHttpsTrafficOnly` on the JS model. Both the
  grader read and the `remediate()` write use the SDK name. No bug. ✅
- instructions.md follows every convention: `<!-- ss:walkthrough -->` sentinel, `## Step N —`
  em-dash headings, 🖱️ Portal + ⌨️ CLI tracks, `>>` breadcrumbs, `[[Click]]` chips,
  `:::refcard`, `## Check your work` / `## Hints` / `## Cleanup` ("wiped clean automatically").
  No internal infra names leak (no SP / stack / subscription-id / pool). ✅

---

## Priority fix list

1. **BLOCKER —** `mintAccess()` reads `learnerRole.Actions/…` but the data lives at
   `learnerRole.permissions[0].actions/…`; the minted role is **empty**. Read from
   `permissions[0]` with lower-case keys. (`engine/azure-infra.mjs` ~L342)
2. **HIGH —** teardown leaves an **orphan custom role *definition*** at the subscription; call
   `roleDefinitions.delete(rgScope, roleDefId)` in `teardown()` (thread the id through ctx).
3. **HIGH —** data-plane probe treats **any non-200 (incl. 5xx / 404) as "blocked"**; tighten to
   403/409-as-pass, 5xx/network/404 as `unknown`. (`engine/graders.azure.mjs` ~L98)
4. **MEDIUM —** deny-delete **fallback path** silently ships with no lock; make it refuse in
   prod or gate behind an explicit flag. (`engine/azure-infra.mjs` ~L183)
5. **MEDIUM —** deny-policy VM-size clause keys on `…/sku.name`, which does not match
   `Microsoft.Compute/virtualMachines` (uses `hardwareProfile.vmSize`); harmless for this lab
   (no compute RBAC) but the fence is weaker than it reads — fix before any compute lab reuses
   it. (`infra/azure/deny-expensive-policy.json`)
6. **LOW —** document that `learnerRole.assignableScopes` placeholder is overridden at
   mint-time; add a synthetic-data comment in `seedBlob()`; note the mgmt-SP RBAC-Admin
   condition constrains assignment but not role-definition writes.

No secrets in source. No privilege-escalation path in the specified role. Fail-closed
throughout. Ship-blocking item is #1 (functional), followed by the teardown-orphan and
probe-tightening hardening.
