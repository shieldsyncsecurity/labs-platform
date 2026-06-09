// Finish baseline for an already-created account. Usage: node finish-provision.mjs <accountId> [alias]
import { baselineAndRegister } from "./provision.mjs";

const accountId = process.argv[2];
const alias = process.argv[3] || "shieldsync-sandbox-002";
if (!accountId) {
  console.log("usage: node finish-provision.mjs <accountId> [alias]");
  process.exit(1);
}
console.log(`\nFinishing baseline for ${accountId} (alias ${alias}) ...\n`);
const r = await baselineAndRegister(accountId, alias);
console.log("\n========== BASELINE COMPLETE ==========");
console.log(JSON.stringify(r, null, 2));
