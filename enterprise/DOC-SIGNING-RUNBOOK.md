# Doc-signing portal — runbook (shipped + E2E-proven 2026-07-15)

Reusable ShieldSync document-signing portal: customers e-accept SOWs / proposals /
agreements online and ShieldSync automatically gets the executed record. ONE
universal flow for any PDF + named signer — zero per-company customization.

**Proven in production 2026-07-15/16 (IST):** real document
(`ShieldSync-Career-Mentoring-Proposal-Kenesha-Khurana.pdf`, 171 KB,
sha256 `af1b9b2f…e5b929`) registered via the admin API, signed at
`/sign/…` with email-OTP verification (verified address
`himanshujain0911@gmail.com`), acceptance record verified in DynamoDB, both
acknowledgment emails delivered, certificate page + PDFs downloadable,
revoke-on-signed correctly refused (409). Display id of the executed record:
`a3b1cb38` (a first registration `a1ba9a16` was revoked — title had a curl
encoding artifact; kept as a revoke-path proof).

## LEGAL WORDING RULE (do not soften)

Click-accept + OTP-verified email + document hash + timestamp = enforceable
acceptance evidence under the Indian Contract Act, 1872 read with IT Act §10A —
but it is NOT an Aadhaar eSign / DSC digital signature under IT Act §3. Every
surface (page, certificate, emails) says **"electronically accepted"**, and the
certificate explicitly disclaims §3. Never write "digitally signed" anywhere.
Aadhaar eSign via Digio/Leegality = possible future paid upgrade, out of scope.

## Architecture

- **Storage:** PDF bytes in S3 `shieldsync-ent-docs-750294427884` (private, BPA
  all-on, versioning ON, key `docs/<docToken>.pdf`); metadata + acceptance
  record in DynamoDB `ShieldSyncEntDocs` (pk `docToken`, **PITR ON, NO TTL** —
  permanent legal records, the Agreements precedent). Created by
  `engine/create-ent-docs-infra.mjs` (idempotent, operator-run).
- **Transport:** PDF rides as base64 inside the engine JSON both ways —
  **4 MB PDF cap** (Lambda 6 MB sync payload; 4 MB × 4/3 ≈ 5.4 MB). The cap is
  enforced engine-side AND app-side; if you raise it, raise BOTH (grep
  `MAX_DOC_PDF_BYTES` in `engine/ent-handler.mjs` and `MAX_PDF_BYTES` in
  `app/api/admin/documents/route.ts`).
- **Integrity:** sha256 of the exact bytes frozen at registration
  (`sha256HexBytes` in entinfra); re-verified on EVERY serve of the PDF
  (mismatch ⇒ fail closed 500, never serve wrong bytes); copied into the
  acceptance record as `docHash` at accept time. Token reuse with different
  content is refused (409 `DOC_TOKEN_REUSED`) *before* any S3 write.
- **Lifecycle (CAS, no read-then-write):** `pending → signed` (terminal; the
  acceptance fields are written in the same conditional update, so a signed row
  is immutable-by-construction — no update path exists) and
  `pending → revoked`. A signed record can NEVER be revoked (409).
- **OTP:** mirrors the invite flow — HMAC-hashed code, 10-min TTL, 45 s send
  cooldown, 10/day cap, 5-attempt sticky lock. Sent ONLY to the registered
  signer email (identity binding); accept = verify + CAS in ONE engine call
  (no verified-but-unaccepted limbo).
- **Acceptance record:** `{docHash, acceptedName (typed), acceptedEmail
  (OTP-verified, copied from the row — never caller input), acceptedAt, acceptIp
  (from cf-connecting-ip, injected app-side), acceptUa}`.
- **Tokens:** `docToken` = 128-bit hex, minted app-side per upload (idempotent
  retry contract, like invites). Shown ONCE at registration; admin list carries
  8-char display ids only; actions resolve display id → token server-side.
  Revoked/unknown are the same oracle-free 404 on every public route.
- **Audit:** every register/accept/revoke/resend writes a CloudWatch audit line
  + a durable `ShieldSyncEntAudit` row under the synthetic partition
  `shieldsync:docs`.

## Engine routes (all pure DynamoDB + SES + S3; nothing async-worker-shaped)

| Route | Who | What |
|---|---|---|
| `POST /ent/docs` | staff (app gate) | register: validates PDF magic + ≤4 MB, S3 put, row put, optional link email |
| `GET /ent/docs` | staff | list (rows include tokens for the app SERVER only; otpHash stripped) |
| `GET /ent/doc?docToken=` | public | sanitized subset (masked signer email; 404 revoked; 410 expired-pending) |
| `GET /ent/doc/pdf?docToken=` | public | exact bytes, hash-checked every read |
| `POST /ent/docs/otp/send` | public | code to the REGISTERED email; cooldown/cap; devCode only outside Lambda |
| `POST /ent/docs/accept` | public | verify + CAS pending→signed + record + both ack emails |
| `POST /ent/docs/revoke` | staff | pending only; signed ⇒ 409 NOT_REVOCABLE |
| `POST /ent/docs/resend` | staff | re-email the signing link; 45 s cooldown |

## App surface

- Public: `/sign/[token]` (view exact PDF → OTP → typed name + checkbox →
  accept), `/sign/[token]/certificate` (print-friendly), `GET
  /api/sign/pdf|certificate?token=`, `POST /api/sign/otp|accept`. All noindex.
- Admin: `/admin/documents` (list + SES sandbox banner), `/admin/documents/new`
  (register; one-time link display + copy), `GET|POST /api/admin/documents`,
  `POST /api/admin/documents/action` (`{id, action: resend|revoke}` by display
  id), `GET /api/admin/documents/certificate?id=`.
- Certificate text renders from ONE builder (`lib/sign/certificate.ts`) for the
  public + staff PDF copies (text-pdf, sha256 in every page footer).

## Ops flows

- **Send a document:** Admin → Documents → Register document → upload PDF,
  title, signer name/email, validity (default 30 d, max 180 d) → copy the
  signing link from the ONE-TIME result screen (and/or let it email the signer).
- **Signer lost the link:** "Resend link email" on the row (goes to the
  registered address only), or revoke + re-register.
- **Wrong document/details:** revoke (pending only), register fresh. Never
  reuse a token.
- **SES sandbox (until prod access granted):** signing-link + OTP + signer-ack
  emails deliver ONLY to SES-verified addresses; the admin UI says so. The ops
  copy to info@shieldsyncsecurity.com always delivers (domain-verified). The
  OTP email is REQUIRED to accept ⇒ until prod access, external signers' email
  addresses must be individually verified in SES first.

## Deploy notes (2026-07-15)

1. `node engine/create-ent-docs-infra.mjs` — table + bucket (idempotent).
2. `engine/deploy/deploy-ent.ps1` — ONE batched engine deploy: re-applied
   `policy-ent.json` (adds `ShieldSyncEntDocs` + docs-bucket object ARNs) +
   `update-function-code` + env merge (no env changes needed; `ENT_APP_URL` is
   unset — email links use the pinned-origin fallback, which is correct).
3. `cd enterprise && npm run cf:deploy` — app (webpack build; Turbopack still
   forbidden).
4. Engine test harness: `node engine/ent-docs-test.mjs` — 35 checks, in-process
   handler against the REAL table/bucket, no AWS burn, cleans up after itself.
   Run it before any engine change to this surface.

- **`ADMIN_PANEL_SECRET` was ROTATED** during the E2E (needed a break-glass
  staff session; owner's Cognito+TOTP path untouched). The new value is not
  recorded anywhere — if break-glass is ever needed, rotate again:
  `cd enterprise && npx wrangler secret put ADMIN_PANEL_SECRET`.
- Engine local-dev/test now needs `@aws-sdk/client-s3`, `client-ses`,
  `client-lambda` (devDependencies; Lambda uses the runtime-provided SDK — the
  deploy zip is unchanged, still the 5 .mjs files + labs/).

## Gotchas (hard-won, this feature)

- **Never S3-put before checking for an existing row** on register — a
  token-reuse attempt would overwrite the bytes a LIVE link serves. (Caught by
  the harness's serve-time hash check; the order is now check-row → put-S3 →
  put-row.)
- The 4 MB cap exists in TWO places (engine + admin route) — change both.
- Doc audit rows live under audit partition `shieldsync:docs` (docs have no
  org; `/admin/forensics` per-org audit won't show them — query the table).
- The `/sign/[token]` PDF `<object>` embed can't render in some embedded
  browsers — the fallback "Open the document" link is by design; real
  Chrome/Edge render inline.
