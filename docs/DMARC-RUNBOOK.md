# DMARC / SPF hardening — shieldsyncsecurity.com

**Why:** `_dmarc` is currently `p=none` with **no `rua`**, so (a) anyone can spoof
`@shieldsyncsecurity.com` and receivers won't reject it, and (b) we have zero
visibility into who is already sending as us. That matters more from launch week
on: candidate OTP + invite mail is business-critical, and DMARC alignment is a
direct deliverability input.

## Verified current state (2026-07-23)

| Record | Value | Verdict |
|---|---|---|
| `shieldsyncsecurity.com` TXT | `v=spf1 include:_spf.mail.hostinger.com ~all` | Hostinger mailboxes only — correct |
| `send.shieldsyncsecurity.com` TXT | `v=spf1 include:amazonses.com ~all` | Resend (SES-backed) — correct |
| `resend._domainkey` | present (RSA) | Resend DKIM ✓ |
| `hostingermail-a._domainkey` | present | Hostinger DKIM ✓ |
| `_dmarc` | `v=DMARC1; p=none` | **no enforcement, no reporting** |
| MX | mx1/mx2.hostinger.com | inbound = Hostinger |

### Alignment analysis — enforcement is safe

Both live senders already align under **relaxed** mode, so tightening the policy
should not drop legitimate mail:

- **Resend** (OTP, invite links, ops alerts): `From: @shieldsyncsecurity.com`,
  DKIM `d=shieldsyncsecurity.com` (selector `resend`) → **DKIM aligned**.
  Return-Path is on `send.shieldsyncsecurity.com` → same org domain → **SPF
  relaxed-aligned**. DMARC passes on either leg.
- **Hostinger mailboxes** (`info@`, `admin@`, `director@`): SPF via the root
  include, DKIM selector `hostingermail-a` → aligned.

> Do **not** add Resend to the root SPF record. Resend sends from the `send.`
> subdomain, which has its own SPF; adding `amazonses.com` at the root would
> widen the root's authorised senders for no benefit.

## Rollout — staged, monitored, launch-safe

Never jump straight to `p=reject`. If any sender is missed, OTP mail dies
silently and the funnel dies with it. Each step below is one Cloudflare DNS
edit to the `_dmarc` TXT record (proxy OFF — it's a TXT record, not traffic).

### Step 1 — reporting only (do NOW, zero delivery risk)

`p=none` changes nothing about delivery; this only starts the telemetry flowing.

**Name:** `_dmarc`  **Type:** `TXT`  **Proxy:** off (TXT is never proxied)

```
v=DMARC1; p=none; rua=mailto:info@shieldsyncsecurity.com; adkim=r; aspf=r
```

Reports go to `info@` deliberately: it is a live, verified mailbox, so this step
has **no prerequisite** and starts collecting immediately. Aggregate reports are
one daily XML per reporting provider (Google, Microsoft, Yahoo…) — a handful a
day at our volume. If it gets noisy later, create a `dmarc@` alias forwarding to
`info@` and change the single `mailto:`, or point it at a free analyser
(Postmark DMARC, dmarcian) for a dashboard instead of raw XML.

Tag notes:
- `adkim=r` / `aspf=r` — relaxed alignment. **Required**: Resend's Return-Path is
  on the `send.` subdomain, which only aligns under relaxed.
- No `ruf=`. Forensic reports embed message content — candidate PII under DPDP —
  most large providers don't send them anyway, and aggregate reports already
  answer "who is sending as us".
- `p=none` means **no change to how any mail is treated**. This step is pure
  telemetry, which is why it is safe to run during launch week.

### Step 2 — quarantine at 25% (only after ~1–2 weeks of clean reports, POST-launch)

```
v=DMARC1; p=quarantine; pct=25; rua=mailto:info@shieldsyncsecurity.com; adkim=r; aspf=r
```

Watch OTP deliverability for a few days, then raise `pct=100`.

### Step 3 — reject (the end state)

```
v=DMARC1; p=reject; rua=mailto:info@shieldsyncsecurity.com; adkim=r; aspf=r
```

Once here, also consider tightening both SPF records from `~all` to `-all`.

## Timing vs. the 29 Jul launch

- **Step 1: now.** No delivery risk, and it means that by the time we're sending
  real candidate mail we already know who's sending as us.
- **Steps 2–3: after launch settles** (roughly mid-Aug). Do not enforce during
  launch week — a missed sender at `p=reject` means candidates stop receiving
  OTPs and there is no error visible to us.

## Verification

```bash
nslookup -type=TXT _dmarc.shieldsyncsecurity.com 8.8.8.8
```

After Step 1, confirm reports arrive within ~48h. Before Step 2, confirm every
report source is a sender we recognise (Hostinger + Resend/SES only).
