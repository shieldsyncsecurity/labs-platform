// Tear down a session (delete stack + return account to pool). Usage: node try-teardown.mjs [sessionId]
import { teardown } from "./labinfra.mjs";

const sessionId = process.argv[2] || "sess_c4v1etkvoo";
console.log(`\nTearing down session ${sessionId} ...`);
const r = await teardown(sessionId);
console.log("\n========== TORN DOWN ==========");
console.log(JSON.stringify(r, null, 2));
