// Vend + baseline a new sandbox account into the pool. Usage: node try-provision.mjs [NNN]
import { provisionSandboxAccount } from "./provision.mjs";

const n = process.argv[2] || "002";
console.log(`\nProvisioning sandbox account ${n} ...\n`);
const r = await provisionSandboxAccount({
  name: `ShieldSync Sandbox ${n}`,
  email: `sbx${n}@shieldsyncsecurity.com`,
  alias: `shieldsync-sandbox-${n}`,
});
console.log("\n========== PROVISIONED ==========");
console.log(JSON.stringify(r, null, 2));
