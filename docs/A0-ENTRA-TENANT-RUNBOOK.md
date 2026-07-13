# A0 — Dedicated Labs Entra Tenant: setup + hardening runbook

**Goal:** a separate Entra (Azure AD) tenant that hosts *throwaway candidate identities* for the
Azure-first hiring assessment, fully isolated from the corp directory. This is the single gate
that unblocks the whole Azure backend build. Also unblocks the B2C Azure Portal labs track.
~15 minutes of owner clicks + 3 decisions.

**Why a separate tenant (not the corp Default Directory):**
- Candidates sign into the *real Azure Portal* to do the assessment — they need a real identity.
- The corp Default Directory (`shieldsyncsecurity.com`) **cannot** safely host stranger
  identities: even hardened, a guest/member in it can enumerate parts of the company directory,
  and you can't apply candidate-hostile directory settings to your whole company. A dedicated
  "ShieldSync Labs" tenant walls candidates off completely — mint a per-session user, delete it
  after, nothing touches the corporate directory.

---

## ⚠️ THE UPSTREAM DECISION (decide before creating anything)

Candidates must reach *resources* (storage accounts, etc.) in a **subscription**, and a
subscription belongs to exactly **one** tenant. So the labs tenant is only useful for Portal work
if a subscription is associated with it. Two options:

- **✅ Recommended — Portal-parity: move the $5k-credit subscription into the new Labs tenant.**
  Azure's "Change directory" transfers the subscription (and its Microsoft-for-Startups credit,
  which stays intact) to the Labs tenant. Then candidates + their resources live in one clean
  tenant. **Caveat:** existing RBAC role assignments on that subscription reset on the move —
  you re-add your own admin access after (2 min). Reversible (you can move it back).
- Alternative — CLI-only: keep the subscription in the corp tenant, give candidates CLI-only
  service-principal creds (no Portal sign-in). Weaker experience; the design chose Portal-parity.

**→ Decision 1: confirm we move the $5k subscription into the Labs tenant** (recommended). If
you'd rather not move that exact subscription, the fallback is to spin a *fresh* subscription in
the Labs tenant — but it won't carry the $5k credit, so moving the credit-subscription is the
right call for a pilot.

**→ Decision 2: tenant name + initial domain.** Proposed: **"ShieldSync Labs"**, initial domain
`shieldsynclabs` → `shieldsynclabs.onmicrosoft.com` (you can add a custom domain later). OK, or
pick another.

**→ Decision 3 (checked during creation): licensing.** Microsoft now restricts creating
*additional* tenants to paid Entra customers, and Conditional Access needs **Entra ID P1**
(~US$6/user/mo, one admin seat is enough). If creation is blocked or CA is unavailable, you'll add
one P1 seat. (Baseline admin MFA is free via Security Defaults even without P1 — see Part 2.)

---

## Part 1 — Create the tenant (~5 min)

1. Azure Portal → search **"Microsoft Entra ID"** → left nav **"Manage tenants"** → **+ Create**.
2. Choose **"Microsoft Entra ID"** (NOT "Azure AD B2C" — B2C is a different product for consumer
   apps; we want a standard workforce tenant for candidate member accounts).
3. **Configuration:**
   - Organization name: `ShieldSync Labs`
   - Initial domain name: `shieldsynclabs`
   - Country/region: pick your data-residency preference (India, if you want candidate data in-region).
4. **Review + Create.** (If blocked with a licensing message → Decision 3: add a P1 seat, retry.)
5. When done, switch into it: top-right **Directory switcher** → select **ShieldSync Labs**.

## Part 2 — Harden the tenant (~10 min) — the important part

*(All inside the new ShieldSync Labs tenant. These make a candidate account near-useless beyond
its one assessment RG.)*

1. **Break-glass admin FIRST** (so you can never lock yourself out): Entra ID → Users → **New
   user** → a cloud-only admin, e.g. `labadmin@shieldsynclabs.onmicrosoft.com`, Global
   Administrator, strong unique password (store in your password manager). Exclude this account
   from any Conditional Access you create.
2. **External collaboration settings** (Entra ID → External Identities → External collaboration
   settings):
   - Guest user access: **"most restrictive"** (limited access to directory object
     properties/memberships).
   - Guest invite settings: **"Only users assigned to specific admin roles can invite"**.
   - **Disable** email one-time-passcode self-service sign-up.
3. **User settings** (Entra ID → Users → User settings):
   - "Users can register applications" → **No**.
   - "Restrict non-admin users from Entra admin center" → **Yes** (candidates can't browse the
     directory).
   - "Users can create tenants" → **No**.
4. **Baseline MFA:**
   - If **no P1**: Entra ID → Properties → Manage security defaults → **Enable** (free; enforces
     MFA on admins, blocks legacy auth). Note: security defaults would also nudge *candidate*
     accounts toward MFA — for throwaway single-session candidate users that's friction; if it
     interferes, switch to P1 + Conditional Access (below) instead.
   - If **P1**: create Conditional Access → **require MFA for admin roles**; **exclude** the
     break-glass account; leave candidate accounts MFA-free (they're single-session, deleted after
     — MFA on them adds friction with no security benefit since they hold no standing access).
5. **No standing candidate access:** confirm there are no leftover users/groups. Candidate users
   are minted per-session by the engine and deleted on submit — nothing persistent lives here.

## Part 3 — Move the subscription (Decision 1, ~3 min) — if Portal-parity

1. Switch back to the corp directory → **Subscriptions** → the Microsoft-for-Startups subscription
   → **Change directory** → choose **ShieldSync Labs** → confirm.
2. After the move, switch into ShieldSync Labs → Subscriptions → the moved sub → **Access control
   (IAM)** → add yourself (or `labadmin`) as **Owner** (RBAC reset on the move — this re-grants you).
3. The $5k credit rides with the subscription — verify it still shows under the moved sub.

## Part 4 — (MY work, once A0 exists) wire it to the engine

Give me these three values from the new tenant and I take it from here:
- **Tenant ID** (Entra ID → Overview → Tenant ID)
- **Subscription ID** (the moved sub)
- Confirmation the **domain** is `shieldsynclabs.onmicrosoft.com` (or the one you chose)

Then I build:
- An **app registration** (`shieldsync-lab-identity`) with Microsoft Graph *application*
  permissions to mint + delete per-session candidate users (least-privilege: `User.ReadWrite.All`
  or a scoped custom directory role) — the ent-engine calls this to create/destroy candidate
  identities.
- A **resource-group-scoped custom role** the engine assigns each candidate (least privilege for
  the scenario, per the content plan).
- The ent-engine **Azure driver** (lease = RG + minted identity → Portal sign-in → grade →
  delete) wiring into the front-end's `TODO(engine)` seams.

---
**Rollback:** a new empty tenant is deletable within 30 days; the subscription move is reversible
("Change directory" back). Nothing here touches the live AWS enterprise engine or the corp
directory's existing users. Low-risk, staged.
