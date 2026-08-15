#!/usr/bin/env node
// Guard against silent DRIFT of values that are HAND-DUPLICATED between the hr and
// billing apps. They build independently (separate Next/OpenNext Workers, no shared
// import), so nothing but this check keeps the copies in sync. If they diverge:
//   * company legal block  -> the client invoice (billing) and the internal record
//     (hr) print DIFFERENT statutory info (legalName / CIN / PAN / address ...).
//   * inv-token ALG/AUD/key-derivation -> billing's jwtVerify throws against a token
//     hr signed, so EVERY client invoice share link 404s — with NO build error.
//
// Run:  node scripts/check-shared-drift.mjs   (exit 1 on drift). Wired into CI via
// .github/workflows/check-shared-drift.yml. Keep hr/ as the canonical source.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL("../" + rel, import.meta.url)), "utf8");

const COMPANY_FIELDS = ["legalName", "shortName", "tagline", "cin", "pan", "email", "phone", "website", "locationLine"];

function extractCompany(src, label) {
  const out = {};
  for (const f of COMPANY_FIELDS) {
    const m = src.match(new RegExp(f + '\\s*:\\s*"([^"]*)"'));
    if (!m) throw new Error(`${label}: could not find COMPANY.${f} (parser needs updating)`);
    out[f] = m[1];
  }
  return out;
}

function extractToken(src, label) {
  const alg = src.match(/const ALG\s*=\s*"([^"]*)"/);
  const aud = src.match(/const AUD\s*=\s*"([^"]*)"/);
  const suffix = src.match(/\+\s*"(:[^"]*)"/); // the ":inv" key-derivation suffix
  const secret = src.match(/process\.env\.([A-Z0-9_]*SESSION_SECRET)/);
  if (!alg || !aud || !suffix || !secret) throw new Error(`${label}: could not parse inv-token constants (parser needs updating)`);
  return { ALG: alg[1], AUD: aud[1], keySuffix: suffix[1], secretEnv: secret[1] };
}

const problems = [];

// 1) Company legal-identity block — hr is canonical.
const hrCo = extractCompany(read("hr/lib/company.ts"), "hr");
const bCo = extractCompany(read("billing/lib/company.ts"), "billing");
for (const f of COMPANY_FIELDS) {
  if (hrCo[f] !== bCo[f]) problems.push(`COMPANY.${f}: hr=${JSON.stringify(hrCo[f])} vs billing=${JSON.stringify(bCo[f])}`);
}

// 2) Invoice share-token — hr SIGNS, billing VERIFIES; the algorithm, audience and
//    key derivation must be byte-identical or every share link silently 404s.
const hrT = extractToken(read("hr/lib/server/inv-token.ts"), "hr");
const bT = extractToken(read("billing/lib/inv-token.ts"), "billing");
for (const k of ["ALG", "AUD", "keySuffix", "secretEnv"]) {
  if (hrT[k] !== bT[k]) problems.push(`inv-token ${k}: hr=${JSON.stringify(hrT[k])} vs billing=${JSON.stringify(bT[k])}`);
}

if (problems.length) {
  console.error("DRIFT between hr/ and billing/ hand-duplicated constants (these MUST match):\n  - " + problems.join("\n  - "));
  console.error("\nFix: reconcile the values (hr/ is canonical), or if the change is intended, apply it to BOTH apps. Then re-run.");
  process.exit(1);
}
console.log(`OK — company block (${COMPANY_FIELDS.length} fields) + inv-token constants match across hr/ and billing/.`);
