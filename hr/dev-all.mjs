// Single-command local dev: starts the dev HR engine (:4002) AND next dev
// (:3003) together, prefixes their output, and kills both on exit.
//   npm run dev:all
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));
const procs = [];

function run(name, cmd, args, cwd, color) {
  const p = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream) =>
    stream.on("data", (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => console.log(tag + l)),
    );
  pipe(p.stdout);
  pipe(p.stderr);
  p.on("exit", (code) => {
    console.log(`${tag}exited (${code}) — shutting down`);
    shutdown();
  });
  procs.push(p);
  return p;
}

function shutdown() {
  for (const p of procs) {
    try {
      p.kill();
    } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("engine", "node", [path.join(__dir, "..", "engine", "hr-server.mjs")], __dir, "36");
run("next", "npm", ["run", "dev"], __dir, "35");
console.log("\x1b[1mShieldSync HR dev — engine :4002 + app :3003 (Ctrl+C stops both)\x1b[0m");
