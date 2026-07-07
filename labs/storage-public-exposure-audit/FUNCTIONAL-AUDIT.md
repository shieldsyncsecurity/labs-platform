# FUNCTIONAL AUDIT — `storage-public-exposure-audit` (Azure lab)

> **⚡ Live-tested on Azure 2026-07-07 — PASS.** On a real sponsored subscription the
> actual `graders.azure.mjs` returned `passed:false` on the broken deploy and
> `passed:true` after remediation; teardown clean (~₹0). Two changes came out of the
> live run and are now applied everywhere: (1) **criterion 3 was swapped**
> `minimum-tls-1-2` → `shared-key-access-disabled` because Azure now forces
> `minimumTLS = 1.2` on new accounts, so a weak-TLS-floor flaw is no longer
> provisionable; (2) the `Microsoft.Storage` provider must be registered on the sub
> first (already handled by `setup-landing-zone.ps1`). Also observed: right after the
> fix the anonymous GET briefly returns **404** before settling to **409** — the grader
> correctly scores that transient as `unknown`, not a pass. The embedded `az` script and
> criterion table below still name the old TLS flaw (superseded by the shared-key
> criterion); the flow is otherwise identical.

Adversarial functional review of every authored file. Focus: does the lab actually
deploy broken, grade `passed:false` on the broken state, grade `passed:true` only
after the exact remediation the instructions teach, and tear down cleanly.

**Verdict: CONCERNS — one CRITICAL wiring bug will make the learner unable to
remediate, plus two functional-risk issues that will bite the live test.** Everything
else (flaws, criteria ids, dual-copy agreement, teardown, cost) is correct.

`node --check` passes on all three `.mjs` files.

## Resolution (applied after this audit)
- **F1 CRITICAL (empty learner role):** ✅ fixed — `mintAccess()` reads `learnerRole.permissions[0].{actions,dataActions,…}` and sets `roleType:"CustomRole"` (`engine/azure-infra.mjs` ~L376–394).
- **F2 HIGH (probe propagation race):** ✅ fixed — `try-azure-lab.mjs` `gradeWithBackoff()` polls criterion 1 up to ~45s; the grader documents the ~30s window.
- **F3 MEDIUM (output-name mismatch):** ✅ fixed — `deploy()` reads `outputs.containerName` (~L227).
- **F4 LOW (grader runs as mgmt identity):** ✅ fixed — `grade()` uses `gradeCredential()` which prefers the read-only probe SP (`AZURE_PROBE_*`) when present (~L74, L430).
- **F5 LOW (`publicAccess:"None"` enum):** correct as written — no change.
- **Extra (found on final review):** the mgmt SP is now also granted **Storage Blob Data Contributor** on each pool RG in `setup-landing-zone.ps1`, so `seedBlob()`'s AAD data-plane upload doesn't 403.

The findings below describe the PRE-FIX state (retained as the audit of record).

---

## Findings (ranked)

### 1. CRITICAL — `mintAccess()` reads the wrong `learnerRole` shape → learner role has ZERO permissions

`lab.json` (engine copy) defines `learnerRole` in the **portal/ARM** shape:

```json
"learnerRole": {
  "roleName": "...",
  "assignableScopes": ["..."],
  "permissions": [
    { "actions": [...], "notActions": [], "dataActions": [...], "notDataActions": [] }
  ]
}
```

But `engine/azure-infra.mjs → mintAccess()` builds the role definition from
**top-level, capitalised** keys that do not exist on that object:

```js
permissions: [{
  actions:        learnerRole.Actions        ?? [],   // undefined -> []
  notActions:     learnerRole.NotActions     ?? [],   // undefined -> []
  dataActions:    learnerRole.DataActions     ?? [],  // undefined -> []
  notDataActions: learnerRole.NotDataActions ?? [],   // undefined -> []
}],
assignableScopes: [rgScope],
```

`learnerRole.Actions` etc. are all `undefined` (the real keys are
`learnerRole.permissions[0].actions`, lowercase, nested). Result: the custom role is
created with an **empty permission set**. The learner is assigned a role that grants
**nothing** — they cannot read or write the storage account, so they cannot remediate
in the portal or via `az`. The lab is unwinnable for a real (non-admin) learner.

The SPEC even lists these fields under the names `Actions:` / `DataActions:` /
`NotActions:` / `NotDataActions:` (RBAC-doc casing), but the authored `lab.json`
stored them under `permissions[0].{actions,dataActions,...}` (SDK/portal casing). The
two halves were written to different conventions and never reconciled.

**Note this does NOT surface in `try-azure-lab.mjs`** — the smoke test never calls
`mintAccess()`; it remediates as the engine SP (full Contributor). So CI would be
green while every real learner is locked out. That is the dangerous part.

**Fix (pick one, keep both halves consistent):**
- Read the nested shape in `mintAccess()`:
  ```js
  const perm = (learnerRole.permissions && learnerRole.permissions[0]) || {};
  permissions: [{
    actions:        perm.actions        ?? [],
    notActions:     perm.notActions     ?? [],
    dataActions:    perm.dataActions     ?? [],
    notDataActions: perm.notDataActions  ?? [],
  }],
  assignableScopes: learnerRole.assignableScopes ?? [rgScope],
  ```
  (and prefer `learnerRole.roleName` / `learnerRole.description` over the derived name
  when present).
- OR change `lab.json` to the flat capitalised shape `mintAccess()` expects. The
  nested `permissions[]` shape is the more Azure-idiomatic one, so fixing the reader is
  preferable.

Also verify `roleDefinitions.createOrUpdate(scope, guid, {...})` payload key: the
`@azure/arm-authorization` SDK wraps the role under
`{ roleName, description, permissions, assignableScopes, roleType: "CustomRole" }`.
`roleType` is not set here; some API versions require it — set
`roleType: "CustomRole"` explicitly rather than relying on inference.

---

### 2. HIGH (functional risk) — criterion-1 data-plane propagation delay can flake the smoke test

Turning off `allowBlobPublicAccess` does make an anonymous GET return **409
PublicAccessNotPermitted**, but the change is **not instant** — Azure has historically
taken up to ~30 s for the anonymous data-plane to stop serving 200s after the account
flag flips. `try-azure-lab.mjs` calls `grade()` **immediately** after `remediate()`
with no delay. If the probe races ahead of propagation, `anonStatus` is still `200`,
`anonBlocked=false`, and criterion 1 reports `passed:false` on a correctly-fixed
account → a **false CI failure**.

The control-plane read (`allowBlobPublicAccess===false`) updates immediately, so the
grade would be a confusing 1-of-2 on criterion 1 (flag right, probe wrong).

**Fix:** in `try-azure-lab.mjs`, after `remediate()`, poll `grade()` with a short
backoff (e.g. up to ~45 s, 5 s interval) until criterion 1 flips or the budget
elapses, instead of a single immediate call. For the live/portal learner this is a
non-issue (they naturally take longer than propagation), but the automated test needs
the retry. Document the propagation window in the grader too so a prod "Check my work"
click right after a save doesn't misreport.

---

### 3. MEDIUM — Bicep output is named `containerName`, but `deploy()` reads `outputs.blobContainer`

`main.bicep` exposes:

```bicep
output containerName string = containerName
```

`azure-infra.mjs → deploy()` reads:

```js
let blobContainer = outputs?.blobContainer?.value ?? "public-data";
```

`outputs.blobContainer` **does not exist** (the output is `containerName`), so this
always falls through to the literal default `"public-data"`. It happens to be correct
**only because** the default string equals the real container name in the Bicep. So it
works today by luck, but the output contract is broken: rename the container in Bicep
and the driver silently keeps using the stale `"public-data"`. Same class of latent
bug for anyone who trusts the stack output.

**Fix:** align the names — either rename the Bicep output to `blobContainer`, or read
`outputs?.containerName?.value` in `deploy()`. (The `anonymousBlobUrl` and
`storageAccountName` outputs ARE named consistently and are read correctly.)

---

### 4. LOW — grade `ctx` passes no `credential` override for the read-only probe SP

The landing-zone `README`/setup provision a dedicated **read-only probe SP**
(`AZURE_PROBE_CLIENT_ID/SECRET`) whose whole reason to exist is to run the grader with
least privilege. But `grade()` builds its credential from the **default**
`DefaultAzureCredential()` (the mgmt SP env vars), not the probe SP. So in prod the
grader would run as the high-privilege mgmt identity, defeating the split-by-blast-
radius design the README advertises. Functionally the grade is still correct; it is a
least-privilege regression, not a wrong result. **Fix:** thread the probe credential
(`ClientSecretCredential` from `AZURE_PROBE_*`) into `grade()`/`gradeAzureLab` when
those env vars are present.

---

### 5. LOW — `blobContainers.update` publicAccess enum value

`try-azure-lab.mjs → remediate()` calls
`sc.blobContainers.update(rg, acct, container, { publicAccess: "None" })`. The
`@azure/arm-storage` `PublicAccess` enum accepts `"Container" | "Blob" | "None"`, so
`"None"` is correct. Confirmed consistent with the Bicep `publicAccess: 'Blob'` on the
broken side. No change needed — flagged only so the live test verifies the container
lock actually took (belt-and-braces; the account flag is the decisive control).

---

## Point-by-point verification (the six asks)

**(1) Bicep encodes all 3 flaws + output names.**
- FLAW A `allowBlobPublicAccess: true` ✅ (line 46) + container `publicAccess: 'Blob'` ✅ (line 69).
- FLAW B `supportsHttpsTrafficOnly: false` ✅ (line 48) — correct ARM property name.
- FLAW C `minimumTlsVersion: 'TLS1_0'` ✅ (line 50).
- Every resource tagged `ShieldSyncLab = labSlug` ✅ (commonTags on account; child
  resources inherit teardown via RG/stack). Account name
  `sslab${uniqueString(resourceGroup().id)}` = 18 chars, lowercase alnum, ≤24 ✅.
- Outputs: `storageAccountName` ✅, `anonymousBlobUrl` ✅ (both read correctly by the
  driver). `containerName` output is **misnamed vs the reader** — Finding 3.
- Seed blob correctly NOT in Bicep (driver uploads post-deploy) ✅.

**(2) Every successCriteria.id appears identically in lab.json AND grader return.**
- `no-anonymous-blob-access` — lab.json ✅ / grader return ✅ / instructions `ss:obj` ✅.
- `secure-transfer-required` — lab.json ✅ / grader ✅ / `ss:obj` ✅.
- `minimum-tls-1-2` — lab.json ✅ / grader ✅ / `ss:obj` ✅.
- Exact string match on all three, across all three files. ✅

**(3) Grader passes=false on broken, =true only after the exact remediation.**
Traced each boolean:

| Criterion | Broken state | Fixed state |
|---|---|---|
| `no-anonymous-blob-access` | `allowPublic=true` → `===false` is `false` → **false** (short-circuits; probe 200 irrelevant) | `allowPublic=false` AND anon GET 409 (`!==200`) → **true** |
| `secure-transfer-required` | `enableHttpsTrafficOnly=false` → `===true` is **false** | remediate sets `enableHttpsTrafficOnly=true` → **true** |
| `minimum-tls-1-2` | `minimumTlsVersion='TLS1_0'` → `==='TLS1_2'` is **false** | remediate sets `TLS1_2` → **true** |

Overall `passed = criteria.every(passed===true && !unknown)`: **false** broken /
**true** fixed. ✅ — modulo Finding 2 (probe race can transiently keep criterion 1
false right after the fix).

**(4) Criterion 1 data-plane GET logic.**
- Broken: anon GET returns 200 (public container + account flag on). Logic short-
  circuits on the flag anyway, so criterion is false regardless. ✅
- Fixed: `allowBlobPublicAccess=false` → anon GET 409 → `anonBlocked=true` → pass. ✅
- `redirect:"manual"` is correct (a 3xx would otherwise be followed and muddy the
  status). Body is drained. A network throw → `probeErr` → `unknown` (never a silent
  pass). Missing URL → `unknown`. All sound. Only caveat is the propagation window
  (Finding 2).

**(5) The two lab.json copies agree on all shared fields.**
`diff` of lines 1–45 is **identical**. Engine copy then adds `_learnerRole` +
`learnerRole`; app copy omits them (correct per spec) and both end with
`estimatedAzureCostInr:1` + `deploysToRegion:"eastus"`. ✅

**(6) Teardown removes everything.**
`teardown()` deletes the Deployment Stack with `unmanageActionResources:"delete"`
(strips managed resources + the deny-assignment), then `resourceGroups.beginDeleteAndWait`
— the RG delete is the authoritative wipe that also removes the seeded blob and the
minted role assignment. Absence-tolerant (404/NotFound = already clean). ✅ Nothing is
left billing. Cost model holds: Standard_LRS + few-KB blob, stacks/roles/policy free at
idle. ✅

---

## LIVE TEST SCRIPT (pure `az` CLI — run this to functionally prove the lab)

Copy-paste into `bash` on a machine with `az` ≥ 2.60, logged in
(`az login`) to a subscription where you can create an RG. This deploys the broken
scenario **without** the engine, seeds the blob, proves the leak, remediates exactly as
the instructions teach, and proves the fix. Expected output is inline after each block.

```bash
set -euo pipefail

# ---- 0. Vars ---------------------------------------------------------------
SUB=$(az account show --query id -o tsv)
LOC=eastus
RG=ss-livetest-storage-$RANDOM
SLUG=storage-public-exposure-audit
# Deterministic-ish unique account name (<=24, lowercase alnum):
ACCT=sslab$(echo "$RG$RANDOM" | md5sum | cut -c1-13)
CONTAINER=public-data
BLOB=customer-export.csv
echo "SUB=$SUB RG=$RG ACCT=$ACCT"

# ---- 1. Resource group -----------------------------------------------------
az group create -n "$RG" -l "$LOC" --tags ShieldSyncLab=$SLUG -o none
# EXPECT: (no error; RG created)

# ---- 2. Deploy the BROKEN account (the 3 flaws) ----------------------------
az storage account create -g "$RG" -n "$ACCT" -l "$LOC" \
  --sku Standard_LRS --kind StorageV2 --access-tier Hot \
  --allow-blob-public-access true \
  --https-only false \
  --min-tls-version TLS1_0 \
  --tags ShieldSyncLab=$SLUG -o none
# EXPECT: (no error). This is the deliberately-broken state.

# ---- 3. Create the anonymous-read container --------------------------------
# Use the account key for the control-plane container op (mirrors the driver).
KEY=$(az storage account keys list -g "$RG" -n "$ACCT" --query "[0].value" -o tsv)
az storage container create -n "$CONTAINER" --account-name "$ACCT" \
  --account-key "$KEY" --public-access blob -o none
# EXPECT: (no error; "created": true)

# ---- 4. Seed the "secret" blob (driver does this post-deploy) --------------
printf 'customer_id,email,card_last4\n1001,alice@example.com,4242\n' > /tmp/$BLOB
az storage blob upload --account-name "$ACCT" --account-key "$KEY" \
  -c "$CONTAINER" -n "$BLOB" -f /tmp/$BLOB --overwrite -o none
# EXPECT: (no error; blob uploaded)

# ---- 5. Show the 3 broken properties (== grader's control-plane reads) -----
az storage account show -g "$RG" -n "$ACCT" \
  --query "{anonBlob:allowBlobPublicAccess, httpsOnly:enableHttpsTrafficOnly, minTls:minimumTlsVersion}" -o json
# EXPECT:
# {
#   "anonBlob": true,
#   "httpsOnly": false,
#   "minTls": "TLS1_0"
# }

# ---- 6. Prove the LEAK: unauthenticated GET returns 200 --------------------
BLOB_URL="https://$ACCT.blob.core.windows.net/$CONTAINER/$BLOB"
curl -s -o /dev/null -w "anon GET (broken) -> HTTP %{http_code}\n" "$BLOB_URL"
# EXPECT: anon GET (broken) -> HTTP 200        <-- criterion 1 is FALSE here

# ============================================================================
#                           R E M E D I A T E
#   Exactly what instructions.md Steps 2-4 teach the learner to do.
# ============================================================================
az storage account update -g "$RG" -n "$ACCT" --allow-blob-public-access false -o none   # Step 2
az storage container set-permission -n "$CONTAINER" --account-name "$ACCT" \
  --account-key "$KEY" --public-access off -o none                                        # Step 2 belt-and-braces
az storage account update -g "$RG" -n "$ACCT" --https-only true -o none                   # Step 3
az storage account update -g "$RG" -n "$ACCT" --min-tls-version TLS1_2 -o none            # Step 4
# EXPECT: (no errors)

# ---- 7. Re-show the 3 properties (== grader after fix) ---------------------
az storage account show -g "$RG" -n "$ACCT" \
  --query "{anonBlob:allowBlobPublicAccess, httpsOnly:enableHttpsTrafficOnly, minTls:minimumTlsVersion}" -o json
# EXPECT:
# {
#   "anonBlob": false,
#   "httpsOnly": true,
#   "minTls": "TLS1_2"
# }

# ---- 8. Prove the FIX: anonymous GET is now blocked ------------------------
# NOTE: allow up to ~30s for the anonymous data-plane to stop serving 200s.
for i in 1 2 3 4 5 6 7 8 9; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BLOB_URL" || echo "000")
  echo "anon GET (fixed) attempt $i -> HTTP $CODE"
  [ "$CODE" != "200" ] && break
  sleep 5
done
# EXPECT (within ~30s): anon GET (fixed) -> HTTP 409   (PublicAccessNotPermitted)
#   -> criterion 1 (flag=false AND GET!=200) now TRUE. If it still 200s past ~30s,
#      confirm the account-level flag actually saved (step 7 anonBlob=false).

# ---- 9. Teardown: delete the RG (the whole wipe) ---------------------------
az group delete -n "$RG" --yes --no-wait
echo "teardown: RG $RG delete issued (async). Nothing left billing."
# EXPECT: (no error). RG + account + container + blob all gone.
```

### What each step proves against the grader
- Step 5 `anonBlob:true, httpsOnly:false, minTls:TLS1_0` = the exact broken values the
  three criteria evaluate → all three FALSE. Matches `try-azure-lab.mjs` "expect every
  criterion FALSE".
- Step 6 `HTTP 200` = the criterion-1 data-plane probe returns 200 on broken → criterion
  1 FALSE (also independently forced false by the flag).
- Step 7 `anonBlob:false, httpsOnly:true, minTls:TLS1_2` = criteria 2 & 3 TRUE, and the
  flag half of criterion 1 TRUE.
- Step 8 `HTTP 409` = the criterion-1 data-plane probe no longer returns 200 → criterion
  1 TRUE. Overall grade → PASS. Matches `try-azure-lab.mjs` "expect every criterion
  TRUE".

### Optional: run the SDK smoke test instead of raw `az`
Once Finding 2's retry is added, the end-to-end SDK path is:
```
cd labs-platform/engine
az bicep build --file labs/storage-public-exposure-audit/main.bicep \
  --outfile labs/storage-public-exposure-audit/main.json     # deploy() needs main.json
export AZURE_SUBSCRIPTION_ID=<sub>                            # + az login or AZURE_* SP
node try-azure-lab.mjs
# EXPECT: broken grade all ✗, fixed grade all ✓, "ALL ASSERTIONS PASSED", exit 0
```
(Requires `@azure/identity`, `@azure/arm-resources`, `@azure/arm-storage`,
`@azure/arm-authorization` installed in `engine/`.)

---

## Bottom line
The scenario, criteria wiring, dual-copy agreement, teardown, and cost model are all
correct, and the broken→fixed grade transition traces cleanly. **Ship-blockers:**
Finding 1 (learner role is empty — real learners can't remediate) must be fixed before
any live learner runs this; Finding 2 (probe race) must be fixed before the CI smoke
test is trusted; Finding 3 (output-name mismatch) should be fixed to remove the latent
trap. Findings 4–5 are polish. The live `az` script above lets you prove the
broken→fixed transition end-to-end without the engine.
