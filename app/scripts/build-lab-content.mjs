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
  return {
    slug: lab.slug,
    title: lab.title,
    level: lab.level,
    free: !!lab.free,
    ready: existsSync(join(LABS_ROOT, slug, "template.yaml")),
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
