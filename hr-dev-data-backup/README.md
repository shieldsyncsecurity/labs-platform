# HR portal — backup checkpoint (2026-07-24)

Session paused. AWS go-live not yet done — blocked on account mismatch
(terminal was authenticated to 851236938541, portal is designed for
750294427884). Resolve that before continuing deploy.

## What's backed up here (this folder)

- `questionnaire-template-snapshot.ts` — the finalized 29-question EA
  questionnaire (dress code, tools list, personal questions, 15-minute
  framing, 36-hour link expiry, all of it). This is the live source at
  `hr/lib/questionnaire.ts` — already committed to git, this is just a
  frozen copy for convenience.
- `GO-LIVE-snapshot.md` — the deploy runbook as it stood.

## What's in git (committed, safe)

Everything under `hr/` and `engine/` — commit `edca608` on `master`,
"HR portal: candidates + questionnaire module, round-2 fixes, doc
features". Run `git log` / `git show edca608 --stat` to see the full
file list.

## What was LOST and is NOT recoverable

The dev engine (`engine/hr-server.mjs`) stores candidates/employees/audit
in a single JSON file under `%TEMP%` — Windows cleaned that folder and
wiped it. Lost:

- The candidate record for **Divyanshi** (name/email/role only — she
  never actually opened or submitted the questionnaire, so no answer
  data was lost).
- Any per-candidate questionnaire edits made in the editor that hadn't
  already been folded into the default template (they mostly had been).
- The Cloudflare tunnel + DNS record `interview.shieldsyncsecurity.com`
  are still configured (see `~/.cloudflared/config.yml`) but point at a
  dev server whose data is gone. The tunnel itself isn't destroyed, just
  the data behind it.

## Before resuming

1. **Fix storage durability first** — dev data must not live in `%TEMP%`
   again. Either point it at a real file inside the repo (git-ignored)
   or just do the real DynamoDB deploy, which has no equivalent problem.
2. **Resolve the AWS account question** — which account
   (750294427884 vs 851236938541) is the actual target, and get the
   right credentials loaded before running any `create-hr-*` scripts.
3. **Re-add Divyanshi as a candidate** — 30 seconds, nothing was
   actually lost from her side since she never got the link.
