// Test runner: bundles the TS payslip lib to a temp ESM file with esbuild
// (already in the dep tree via OpenNext), then runs the node:test suites.
// Zero new dependencies.  Usage:  npm test   (from hr/)
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dir, ".build");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(__dir, "..", "lib", "payslip.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: path.join(out, "payslip.mjs"),
});

const res = spawnSync(process.execPath, ["--test", path.join(__dir, "payslip.test.mjs")], { stdio: "inherit" });
process.exit(res.status ?? 1);
