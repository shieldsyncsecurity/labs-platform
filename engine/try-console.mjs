// Mint a console sign-in URL for a deployed lab. Usage: node try-console.mjs [accountId]
import { mintConsoleUrl } from "./labinfra.mjs";

const accountId = process.argv[2] || "244686897857";
console.log(`\nMinting a console URL into account ${accountId} ...`);
const r = await mintConsoleUrl({ accountId });
console.log(`\n========== LEARNER CONSOLE URL (valid ~${r.expiresInSeconds}s) ==========\n`);
console.log(r.consoleUrl);
