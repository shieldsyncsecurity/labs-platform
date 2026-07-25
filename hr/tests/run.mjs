// Test runner: bundles the pure TS libs to temp ESM files with esbuild (already
// in the dep tree via OpenNext), then runs every *.test.mjs suite.
// Zero new dependencies.  Usage:  npm test   (from hr/)
import { build } from "esbuild";
import { mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dir, ".build");
mkdirSync(out, { recursive: true });

// Pure, dependency-free modules the suites import. Anything that touches
// next/headers or the engine secret is deliberately NOT bundled — those paths
// are exercised through the engine E2E suite instead.
for (const mod of ["payslip", "access", "access-routes", "questionnaire", "scheduling", "server/payroll-due"]) {
  await build({
    entryPoints: [path.join(__dir, "..", "lib", `${mod}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: path.join(out, `${path.basename(mod)}.mjs`),
  });
}

// Auto-discovered so a new suite is picked up by existing it, not by remembering
// to register it here.
const suites = readdirSync(__dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => path.join(__dir, f));

const res = spawnSync(process.execPath, ["--test", ...suites], { stdio: "inherit" });
process.exit(res.status ?? 1);
