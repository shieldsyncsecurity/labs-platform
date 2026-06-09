// Quick manual test for lease(). Usage: node try-lease.mjs [userId] [labSlug]
import { lease } from "./labinfra.mjs";

const userId = process.argv[2] || "demo-learner";
const labSlug = process.argv[3] || "s3-misconfiguration-audit";

console.log(`\nLeasing an account  user=${userId}  lab=${labSlug} ...\n`);
try {
  const result = await lease(userId, labSlug);
  console.log("LEASED:\n" + JSON.stringify(result, null, 2));
} catch (e) {
  console.log("lease() threw:", e.message);
  if (e.message === "NO_CAPACITY") console.log("(pool exhausted — in the app this becomes a queue)");
}
