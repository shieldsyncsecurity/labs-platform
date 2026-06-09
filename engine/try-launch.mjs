// Full flow test: lease an account, then deploy the lab into it.
// Usage: node try-launch.mjs [userId] [labSlug]
import { lease, deployLab } from "./labinfra.mjs";

const userId = process.argv[2] || "demo-learner";
const labSlug = process.argv[3] || "s3-misconfiguration-audit";

console.log(`\n[1/2] lease   user=${userId}  lab=${labSlug}`);
const leased = await lease(userId, labSlug);
console.log("  ->", JSON.stringify(leased));

console.log(`\n[2/2] deploy  the lab CloudFormation into account ${leased.accountId}`);
const deployed = await deployLab({ ...leased, labSlug });

console.log("\n========== LAB DEPLOYED ==========");
console.log("stack:", deployed.stackName);
console.log("outputs:");
console.log(JSON.stringify(deployed.outputs, null, 2));
