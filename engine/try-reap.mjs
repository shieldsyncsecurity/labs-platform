// Reap expired sessions (auto-teardown). Usage: node try-reap.mjs
import { reap } from "./labinfra.mjs";

console.log("\nScanning for expired sessions to reap ...\n");
const r = await reap();
console.log("\n========== REAP RESULT ==========");
console.log(JSON.stringify(r, null, 2));
