// One-off verification of the pay-per-lab v2 entitlement CAS against the LIVE
// DynamoDB, using a throwaway test user (cleaned up at the end). Proves:
//   - grant writes the v2 budget shape
//   - reserveLaunch is an atomic version-CAS (stale version rejected)
//   - the launch cap is enforced (reserve past maxLaunches rejected)
//   - the 7-day window is stamped on first launch
//   - rollbackLaunch frees a consumed slot
//   - re-grant is idempotent (a "retry" can't refill a used budget)
// Run:  node verify-payperlab.mjs   (uses the local mgmt->platform creds bridge)

import {
  grantEntitlement,
  listEntitlements,
  reserveLaunch,
  rollbackLaunch,
  deleteEntitlement,
} from "./labinfra.mjs";

const U = `test-ppl-${Date.now().toString(36)}`;
const L = "verify-lab";
const MAX = 3; // small budget for the test
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

async function ent() {
  return (await listEntitlements(U)).find((e) => e.labSlug === L) ?? null;
}

try {
  console.log(`\n[verify] user=${U} lab=${L} maxLaunches=${MAX}\n`);

  // 1. Grant v2 PAY_PER_LAB
  await grantEntitlement(U, {
    labSlug: L, kind: "per-lab",
    accessUntil: new Date(Date.now() + 90 * 864e5).toISOString(),
    type: "PAY_PER_LAB", maxLaunches: MAX, orderId: "order_test",
  });
  let e = await ent();
  ok(e?.type === "PAY_PER_LAB", `grant: type=PAY_PER_LAB (got ${e?.type})`);
  ok(e?.launchCount === 0, `grant: launchCount=0 (got ${e?.launchCount})`);
  ok(e?.version === 0, `grant: version=0 (got ${e?.version})`);
  ok(e?.maxLaunches === MAX, `grant: maxLaunches=${MAX} (got ${e?.maxLaunches})`);
  ok(e?.windowExpiresAt == null, `grant: window NOT yet stamped (got ${e?.windowExpiresAt})`);

  // 2. Re-grant (idempotent retry) must NOT reset the budget — bump a launch first
  let r = await reserveLaunch(U, L, 0);
  ok(r.ok && r.launchesRemaining === MAX - 1, `reserve#1 ok, remaining=${r.launchesRemaining}`);
  e = await ent();
  ok(e?.version === 1 && e?.launchCount === 1, `reserve#1: version=1 launchCount=1 (got v${e?.version} c${e?.launchCount})`);
  ok(e?.windowExpiresAt != null, `reserve#1: window stamped on first launch`);
  await grantEntitlement(U, { labSlug: L, kind: "per-lab", type: "PAY_PER_LAB", maxLaunches: MAX, orderId: "order_test" });
  e = await ent();
  ok(e?.launchCount === 1 && e?.version === 1, `re-grant idempotent: budget NOT reset (v${e?.version} c${e?.launchCount})`);

  // 3. Stale version rejected (optimistic-concurrency CAS)
  r = await reserveLaunch(U, L, 0); // version is now 1, not 0
  ok(!r.ok && r.code === "CONCURRENT_LAUNCH_OR_LIMIT", `stale-version reserve rejected (got ${JSON.stringify(r)})`);

  // 4. Correct version succeeds, up to the cap
  r = await reserveLaunch(U, L, 1);
  ok(r.ok && r.launchesRemaining === MAX - 2, `reserve#2 ok, remaining=${r.launchesRemaining}`);
  r = await reserveLaunch(U, L, 2);
  ok(r.ok && r.launchesRemaining === 0, `reserve#3 ok, remaining=0 (cap reached)`);

  // 5. Cap enforced — next reserve rejected even with correct version
  r = await reserveLaunch(U, L, 3);
  ok(!r.ok && r.code === "CONCURRENT_LAUNCH_OR_LIMIT", `over-cap reserve rejected (got ${JSON.stringify(r)})`);
  e = await ent();
  ok(e?.launchCount === MAX, `cap: launchCount stays at ${MAX} (got ${e?.launchCount})`);

  // 6. Rollback frees a slot, then a reserve works again
  await rollbackLaunch(U, L);
  e = await ent();
  ok(e?.launchCount === MAX - 1, `rollback: launchCount ${MAX}->${e?.launchCount}`);
  r = await reserveLaunch(U, L, e.version); // re-read version after rollback
  ok(r.ok, `reserve after rollback ok (remaining=${r.launchesRemaining})`);

  // 7. Rollback never goes below 0
  await rollbackLaunch(U, L); await rollbackLaunch(U, L); await rollbackLaunch(U, L); await rollbackLaunch(U, L);
  e = await ent();
  ok(e?.launchCount === 0, `rollback floor: launchCount=0 (got ${e?.launchCount})`);
} catch (err) {
  console.error("\n[verify] ERROR:", err);
  failures++;
} finally {
  await deleteEntitlement(U, L).then(() => console.log(`\n[verify] cleaned up ${U}`)).catch((e) => console.error("cleanup failed:", e.message));
  console.log(failures === 0 ? "\n✅ ALL CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
