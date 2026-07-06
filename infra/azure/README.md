# ShieldSync Labs — Azure landing zone (one-time setup)

This directory is the **Azure analog of `infra/` (the AWS SCP + aws-nuke sandbox)**. It sets up the
_one_ Azure subscription that backs every free/paid **Azure** lab (the first being
`storage-public-exposure-audit`). Do this **once per account**; after that the engine
(`engine/azure-infra.mjs`) leases a resource group, deploys the lab, grades, and tears down on its own.

Unlike the AWS model — a **pool of sandbox accounts**, one per lease — Azure uses **one sponsored
subscription** and a **pool of resource groups** inside it, one RG per active lease. An RG is the
teardown unit: delete the RG and everything the learner touched is gone. That is cheaper and simpler
than juggling many subscriptions, and it is exactly what a Microsoft-for-Startups sponsored sub gives
us room for.

> **Cost.** Everything here is free at idle: RGs, service principals, custom roles, role
> assignments, and Azure Policy assignments cost **₹0**. The only spend is a few-KB Standard_LRS blob
> while a lab is live. The deny-policy fence (below) makes it impossible for a learner — or a buggy
> template — to create anything that bills at idle.

---

## What gets created

| Thing | Name (default) | Why |
|---|---|---|
| **Labs subscription** | _the sponsored sub_ | Microsoft-for-Startups sponsored credit; isolate labs from any prod/personal sub. |
| **Resource-group pool** | `ss-lab-pool-001…NNN` | One RG per lease. The engine leases a free one, deploys into it, tears it down (delete RG) after. |
| **Management service principal** | `shieldsync-lab-mgmt` | The engine's identity. Deploys/tears down labs, mints the learner's scoped role assignment. High-privilege but **contributor-on-the-pool only**, never Owner of the sub. |
| **Read-only probe service principal** | `shieldsync-lab-probe` | The grader's identity. **Reader** + Storage control-plane read only — used by `graders.azure.mjs` to read account flags. It has NO write and cannot see keys, so a leaked probe secret can't change or exfiltrate anything. |
| **Deny-expensive policy** | `shieldsync-labs-deny-expensive` | The SCP analog. Denies large VMs, AKS, managed DBs, public IPs, NAT gateways, etc., and locks the region to `eastus`. Assigned at the **subscription** scope so it covers every pool RG. See `deny-expensive-policy.json`. |

### Why two service principals (least privilege, split by blast radius)

- The **mgmt SP** can write (it must, to deploy and remediate-test), so we keep its scope tight —
  **Contributor on the RG pool**, plus **Role Based Access Control Administrator** (conditioned to
  only assign the single custom learner role) so it can grant the learner their scoped role at
  lease-time. It is **never** Owner and **never** subscription-wide Contributor.
- The **probe SP** is the identity the grader runs as. Read-only means a compromised grading path
  cannot mutate a learner's environment or read storage keys. This mirrors the AWS split where the
  learner role (`ShieldSyncLabUser`) is separate from the deploy role (`ShieldSyncLabExec`).

> The **learner** never gets an SP. At lease-time the engine assigns the learner principal a
> **custom RBAC role** scoped to _their RG only_ (defined in `engine/labs/<slug>/lab.json →
> learnerRole`). That role is the Azure analog of the S3 lab's STS session policy: read/write on
> Storage + blob containers in their RG, blob **data-read** so they can prove the leak, and **no
> delete, no key-list, no `Microsoft.Authorization/*/write`, nothing at subscription scope**.

---

## Prerequisites

1. **Azure CLI** (`az`) ≥ 2.60, signed in as an **Owner** of the sponsored subscription:
   ```
   az login
   az account set --subscription "<SUBSCRIPTION_ID>"
   ```
   (Owner is needed _once_, to create the SPs, custom role, and policy assignment. Day-to-day, the
   engine runs as the low-privilege mgmt SP.)
2. **PowerShell 7+** (`pwsh`) to run `setup-landing-zone.ps1`.
3. The **`Microsoft.Storage` and `Microsoft.Authorization` resource providers** registered on the
   sub (the script registers them if missing).

---

## Run it

```powershell
# from labs-platform/infra/azure
pwsh ./setup-landing-zone.ps1 `
    -SubscriptionId "<SUBSCRIPTION_ID>" `
    -PoolSize 5 `
    -Location eastus
```

The script is **idempotent** — re-running it will not duplicate SPs, roles, RGs, or the policy
assignment; it reconciles to the desired state. It prints, at the end, the **exact env vars** to put
in the engine's `.env` (or the deploy Lambda/Function config):

```
AZURE_SUBSCRIPTION_ID=...
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...            # the mgmt SP appId
AZURE_CLIENT_SECRET=...        # the mgmt SP secret  (store in a secret manager, NOT git)
AZURE_SANDBOX_LOCATION=eastus
# probe SP (grader) — used by graders.azure.mjs's read-only credential
AZURE_PROBE_CLIENT_ID=...
AZURE_PROBE_CLIENT_SECRET=...
```

> **Secrets.** `setup-landing-zone.ps1` prints the SP secrets **once**. Copy them into your secret
> store immediately (they cannot be re-read; re-running the script rotates them). Never commit them.

---

## How this maps to the AWS side

| AWS (this repo's `infra/`) | Azure (here) |
|---|---|
| Sandbox **account** pool | Resource-**group** pool in one sponsored subscription |
| `ShieldSyncLabExec` (deploy role) | **mgmt SP** `shieldsync-lab-mgmt` |
| `ShieldSyncLabUser` (learner console) | Per-lease **custom RBAC role** (`learnerRole` in lab.json) |
| — (grader assumed Exec) | Dedicated read-only **probe SP** `shieldsync-lab-probe` |
| `scp-sandbox-deny-expensive.json` | `deny-expensive-policy.json` (Azure Policy) |
| `aws-nuke-sandbox.yaml` teardown | **Delete the RG** (`az group delete`) — the RG _is_ the blast boundary |
| CloudFormation stack per lab | **Deployment Stack** per lab (`denyDelete`, action-on-unmanage `deleteAll`) |

**Teardown difference worth knowing:** AWS needs aws-nuke because a learner can create resources
_outside_ the CloudFormation stack anywhere in the account. In Azure, the learner's custom role is
scoped to a single RG and the deny-policy caps what can exist at all, so **deleting the RG is a
complete wipe** — there is no cross-account cruft to sweep. Keep it that way: never widen the learner
role beyond their RG.

---

## Maintenance

- **Rotate SP secrets** on a schedule (the script's `-RotateSecrets` switch re-issues them).
- **Grow the pool** by re-running with a larger `-PoolSize`; existing RGs are left untouched.
- **Update the deny fence** by editing `deny-expensive-policy.json` and re-running the script; it
  updates the policy definition in place and re-points the assignment.
