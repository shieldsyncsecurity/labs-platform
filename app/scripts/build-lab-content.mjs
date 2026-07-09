// Generates app/lib/lab-content.ts from the lab content sources.
// Source of truth: app/content/labs/<slug>/instructions.md (+ lab.json for objectives).
// Run from app/:  node scripts/build-lab-content.mjs
//
// Why a generator: the app renders instructions from a TS module (Cloudflare
// Workers can't fs-read at request time), but markdown is far nicer to author as
// .md files. Edit the .md, run this, commit both. Properly escapes via JSON.stringify.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dirname, "..", "content", "labs");
const OUT = join(__dirname, "..", "lib", "lab-content.ts");

const slugs = readdirSync(CONTENT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  // skip incomplete/leftover dirs (e.g. empty dirs from deleted labs)
  .filter((d) => existsSync(join(CONTENT, d.name, "instructions.md")) && existsSync(join(CONTENT, d.name, "lab.json")))
  .map((d) => d.name)
  .sort();

const instructions = {};
const objectives = {};
for (const slug of slugs) {
  instructions[slug] = readFileSync(join(CONTENT, slug, "instructions.md"), "utf8");
  const lab = JSON.parse(readFileSync(join(CONTENT, slug, "lab.json"), "utf8"));
  objectives[slug] = (lab.successCriteria ?? []).map((c) => ({ id: c.id, description: c.description }));
}

const entries = (obj) => slugs.map((s) => `  ${JSON.stringify(s)}: ${JSON.stringify(obj[s])},`).join("\n");

const out = `// AUTO-GENERATED — do not edit by hand.
// Source: app/content/labs/<slug>/  (instructions.md + lab.json)
// Regenerate: node scripts/build-lab-content.mjs  (from app/)

type Objective = { id: string; description: string };

export const labInstructions: Record<string, string> = {
${entries(instructions)}
};

export const labObjectives: Record<string, Objective[]> = {
${entries(objectives)}
};
`;

writeFileSync(OUT, out);
console.log(`Wrote ${OUT} from ${slugs.length} lab(s): ${slugs.join(", ")}`);

// ── Catalog metadata (lightweight — NO instructions) ────────────────────────
// Generated from each lab.json so lib/labs.ts is a single source DERIVED from
// lab.json, not a hand-kept duplicate that drifts. `ready` = a CloudFormation
// template exists at labs-platform/labs/<slug>/template.yaml. Kept in a separate
// file from lab-content.ts so importing the catalog doesn't pull in the heavy
// instructions strings.
const LABS_ROOT = join(__dirname, "..", "..", "labs");
const catalog = slugs.map((slug) => {
  const lab = JSON.parse(readFileSync(join(CONTENT, slug, "lab.json"), "utf8"));
  const track = lab.track ?? "aws";
  // `ready` = the engine can actually launch it. AWS: a CloudFormation template exists.
  // Azure: keep FALSE for now — the lab + IaC (main.bicep) exist and are live-tested, but
  // the engine's Azure launch dispatch isn't wired yet, so it must not show a live Launch.
  // Flip to (main.bicep exists) once handler.mjs dispatches track:"azure".
  const ready = track === "aws" && existsSync(join(LABS_ROOT, slug, "template.yaml"));
  return {
    slug: lab.slug,
    track,
    title: lab.title,
    level: lab.level,
    free: !!lab.free,
    ready,
    summary: lab.summary,
    tags: lab.tags ?? [],
    estimatedActiveMinutes: lab.estimatedActiveMinutes,
  };
});

const CATALOG_OUT = join(__dirname, "..", "lib", "lab-catalog.ts");
const catalogOut = `// AUTO-GENERATED — do not edit by hand.
// Source: app/content/labs/<slug>/lab.json (+ labs/<slug>/template.yaml for \`ready\`)
// Regenerate: node scripts/build-lab-content.mjs  (from app/)
import type { Lab } from "./labs";

export const labCatalog: Lab[] = ${JSON.stringify(catalog, null, 2)};
`;
writeFileSync(CATALOG_OUT, catalogOut);
console.log(`Wrote ${CATALOG_OUT} (${catalog.length} labs)`);

// ── Least-privilege gate ────────────────────────────────────────────────────
// Every READY lab (has a CloudFormation template) MUST declare a `learnerPolicy`
// in its ENGINE-side lab.json (labs/<slug>/lab.json — the copy the engine bundles
// and reads at console-mint to fence the learner's session to exactly what the lab
// needs). A ready lab WITHOUT one would mint an UNSCOPED admin console, so fail the
// build — this is the scalable guardrail as the catalog grows to 100 labs.
// STS PACKS (compresses) session policies and the PACKED size — not the 2048-char
// plaintext limit — is the real ceiling. Empirically a ~1166-char bare doc already
// blew the packed budget (PackedPolicyTooLarge), so gate conservatively on the bare
// plaintext: keep each lab's learnerPolicy doc well under ~1000 chars, preferring
// resource-scoped wildcards (e.g. s3:* on the lab buckets) over long action lists.
// The AUTHORITATIVE check is engine/verify-leastpriv.mjs (assumes the role with the
// real merged policy and probes allow/deny).
const MAX_BARE_POLICY_CHARS = 1000;
for (const slug of slugs) {
  if (!existsSync(join(LABS_ROOT, slug, "template.yaml"))) continue; // not ready → exempt
  const engineLabJson = join(LABS_ROOT, slug, "lab.json");
  if (!existsSync(engineLabJson)) {
    throw new Error(`[least-priv] READY lab "${slug}" has no engine lab.json at ${engineLabJson}`);
  }
  const lp = JSON.parse(readFileSync(engineLabJson, "utf8")).learnerPolicy;
  const statements = Array.isArray(lp) ? lp : Array.isArray(lp?.Statement) ? lp.Statement : null;
  if (!statements || !statements.length) {
    throw new Error(
      `[least-priv] READY lab "${slug}" is missing a non-empty learnerPolicy in ${engineLabJson} — it would mint an UNSCOPED admin console. Add a least-privilege Statement[] (copy the shape from another lab).`
    );
  }
  const size = JSON.stringify({ Version: "2012-10-17", Statement: statements }).length;
  if (size > MAX_BARE_POLICY_CHARS) {
    throw new Error(`[least-priv] "${slug}" learnerPolicy is ${size} chars; keep it under ${MAX_BARE_POLICY_CHARS} (STS packs session policies — a larger doc can exceed the packed limit; verify with engine/verify-leastpriv.mjs).`);
  }
  console.log(`  [least-priv] ${slug}: learnerPolicy OK (${size} chars bare)`);
}
