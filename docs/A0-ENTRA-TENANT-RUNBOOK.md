# A0 — `ShieldSync Enterprise Labs` (B2B) Entra Tenant: setup + hardening runbook

**Goal:** a separate Entra (Azure AD) tenant that hosts *throwaway candidate identities* for the
**B2B** Azure-first hiring assessment, fully isolated from the corp directory. This is the single
gate that unblocks the whole Azure backend build. ~15 minutes of owner clicks + 3 decisions.

**⚡ SEGREGATION DECISION (owner, 2026-07-12): B2C and B2B get SEPARATE tenants.**
This tenant (**"ShieldSync Enterprise Labs"**) is for **B2B hiring-assessment candidate identities
only**. The **B2C** learner Azure-Portal track will get its **own** separate tenant
(**"ShieldSync Labs"**) when that track launches — mirroring the existing B2C/B2B blast-radius
isolation (separate engine Lambdas, tables, Cognito pools). A *shared* identity tenant would let
public learners enumerate hiring candidates and blur the data/retention regimes — keep them apart.
Only the B2B "Enterprise Labs" tenant is built now; "ShieldSync Labs" is a future, separate build.

**Why a separate tenant (not the corp Default Directory):**
- Candidates sign into the *real Azure Portal* to do the assessment — they need a real identity.
- The corp Default Directory (`shieldsyncsecurity.com`) **cannot** safely host stranger
  identities: even hardened, a guest/member in it can enumerate parts of the company directory,
  and you can't apply candidate-hostile directory settings to your whole company. A dedicated
  "ShieldSync Enterprise Labs" tenant walls candidates off completely — mint a per-session user,
  delete it after, nothing touches the corporate directory.

---

## ⚠️ THE UPSTREAM DECISION — the subscription (CORRECTED 2026-07-12)

Candidates must reach *resources* (storage, etc.) in a **subscription**, and a subscription
belongs to exactly **one** tenant. So the Enterprise Labs tenant needs a subscription of its own.

**IMPORTANT correction:** the $5k credit is an Azure **Sponsorship** subscription (Founders Hub,
offer MS-AZR-0036P). **It CANNOT be self-service "Change directory"'d** into another tenant —
sponsorship subs require an **entitlement transfer via a Microsoft for Startups support ticket**
(days, not a click; resets RBAC + breaks Key Vault). So do NOT plan the pilot around moving it.

Two clean options — **recommend A for the pilot:**

- **✅ A (pilot, immediate): a fresh Pay-As-You-Go subscription in the Enterprise Labs tenant.** Candidate
  resources cost ~pennies/session (a storage account + a function for 1 hour is negligible), so
  real spend for a whole pilot is a few dollars. Needs a card on the new sub. The **$5k credit
  stays untouched** on the corp side. No ticket, no wait, no risk to the credit.
- B (fund from the credit, slower): file a **Microsoft for Startups entitlement-transfer ticket**
  to move the sponsorship subscription into the Enterprise Labs tenant. Takes days; can run **in parallel** —
  pilot on PAYG now, switch to the credit-sub once the transfer completes.

**→ Decision 1: PAYG-in-Enterprise-Labs-tenant now (A), and optionally file the entitlement-transfer
ticket (B) in parallel to fund it from the $5k long-term.** (I'll draft the ticket text if you want B.)

**→ Decision 2: names — LOCKED (owner, 2026-07-12):**
- **Org (display) name:** `ShieldSync Enterprise Labs`.
- **`.onmicrosoft.com` initial domain:** ✅ **CREATED** — `shieldsyncenterprise.onmicrosoft.com`
  (B2B tenant). (B2C tenant `shieldsynclabs.onmicrosoft.com` also created — for the B2C chat.)
- **Custom login domain (candidate-facing):** ✅ **LOCKED — `assess.shieldsyncsecurity.com`** →
  candidates sign into the Azure Portal as `candidate-a1b2@assess.shieldsyncsecurity.com`. Added
  *after* tenant creation (Part 2c): Entra gives a TXT record → add on Cloudflare → verify →
  **Make primary**. (B2C reserves `learn.shieldsyncsecurity.com` — built in the separate B2C
  chat, NOT here.) **Do NOT reuse `enterprise.` / `labs.` — those are the LIVE web apps, a
  collision.** Custom domain is polish, not a pilot blocker (onmicrosoft works meanwhile).

**→ Decision 3 (checked during creation): licensing.** Microsoft now restricts creating
*additional* tenants to paid Entra customers, and Conditional Access needs **Entra ID P1**
(~US$6/user/mo, one admin seat is enough). If creation is blocked or CA is unavailable, you'll add
one P1 seat. (Baseline admin MFA is free via Security Defaults even without P1 — see Part 2.)

---

## Part 1 — Create the tenant (~5 min) — ✅ DONE (owner, 2026-07-12: `shieldsyncenterprise.onmicrosoft.com` created)

1. Azure Portal → search **"Microsoft Entra ID"** → left nav **"Manage tenants"** → **+ Create**.
2. Choose **"Microsoft Entra ID"** (NOT "Azure AD B2C" — B2C is a different product for consumer
   apps; we want a standard workforce tenant for candidate member accounts).
3. **Configuration:**
   - Organization name: `ShieldSync Enterprise Labs`
   - Initial domain name: `shieldsyncenterprise`
   - Country/region: pick your data-residency preference (India, if you want candidate data in-region).
4. **Review + Create.** (If blocked with a licensing message → Decision 3: add a P1 seat, retry.)
5. When done, switch into it: top-right **Directory switcher** → select **ShieldSync Enterprise Labs**.

## Part 2 — Harden the tenant (~10 min) — the important part

*(All inside the new ShieldSync Enterprise Labs tenant. These make a candidate account near-useless beyond
its one assessment RG.)*

1. **Break-glass admin FIRST** (so you can never lock yourself out): Entra ID → Users → **New
   user** → a cloud-only admin, e.g. `labadmin@shieldsyncenterprise.onmicrosoft.com`, Global
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

## Part 2c — Custom domain (optional but high-polish, ~10 min incl. DNS wait)

So candidates sign in as `candidate-x@assess.shieldsyncsecurity.com` instead of the ugly
`@shieldsyncenterprise.onmicrosoft.com`:
1. Entra ID → **Custom domain names** → **+ Add custom domain** → `assess.shieldsyncsecurity.com`.
2. Entra shows a **TXT** (or MX) record. Add it on **Cloudflare** (the shieldsyncsecurity.com DNS)
   as a DNS-only (grey-cloud) TXT record — I can do this DNS step or hand you the exact values.
3. Back in Entra → **Verify**.
4. **Make primary** so every candidate identity the engine mints defaults to
   `@assess.shieldsyncsecurity.com`.
*(Skip for a first pilot if you like — the onmicrosoft domain works; this is a polish upgrade.)*

## Part 3 — Give the Enterprise Labs tenant a subscription (Decision 1)

**Path A (recommended, immediate):** inside the ShieldSync Enterprise Labs tenant → **Subscriptions** →
**+ Add** → **Pay-As-You-Go** → complete the billing sign-up (card). This creates a Microsoft
Customer Agreement billing account in the Enterprise Labs tenant with a subscription candidates' resources
live in. Real cost for a pilot ≈ a few dollars total (per-session resources are pennies).

**Path B (optional, parallel, to use the $5k credit):** open a **Microsoft for Startups support
ticket** requesting an *entitlement transfer* of the Founders Hub sponsorship subscription
(MS-AZR-0036P) to the ShieldSync Enterprise Labs tenant. Do NOT try "Change directory" — it's not supported
for sponsorship subs. Once transferred, re-add your admin RBAC (reset on move) and fix any Key
Vaults. Switch the engine to this sub when it lands.

*(Do NOT move the corp Microsoft-for-Startups subscription via self-service — it is not
supported for this offer type and risks the credit.)*

## Part 4 — (MY work, once A0 exists) wire it to the engine

Give me these three values from the new tenant and I take it from here:
- **Tenant ID** (Entra ID → Overview → Tenant ID)
- **Subscription ID** (the moved sub)
- Confirmation the **domain** is `shieldsyncenterprise.onmicrosoft.com` (or the one you chose)

Then I build:
- An **app registration** (`shieldsync-ent-identity`) with Microsoft Graph *application*
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
