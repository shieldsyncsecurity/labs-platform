// Full end-to-end smoke test for the Azure lab (storage-public-exposure-audit).
// Mirrors try-launch.mjs but exercises the whole Azure lifecycle AND the fix loop:
//
//   lease -> deploy -> seedBlob
//     -> grade  (EXPECT all criteria FALSE — the scenario ships broken)
//     -> remediate (flip the 3 flags + lock the container, via the SDK)
//     -> grade  (EXPECT all criteria TRUE — the learner's fix verified)
//     -> teardown (delete the RG; nothing left billing)
//
// This is what the LEARNER does by hand in the portal/CLI, driven here by the SDK
// so the whole thing is verifiable without a human. Clear console asserts at each
// gate; a failed expectation exits non-zero so CI catches a regression.
//
// Usage: node try-azure-lab.mjs
// Requires: AZURE_SUBSCRIPTION_ID (+ az login OR AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET),
//           a compiled labs/storage-public-exposure-audit/main.json (az bicep build),
//           and the engine identity holding Contributor + Storage Blob Data
//           Contributor on the sandbox subscription.
//
// DOES NOT run in this authoring env (no az / no Azure creds) — authored + node
// --check'd only; the user runs the live pass.

import { lease, deploy, seedBlob, grade, teardown } from "./azure-infra.mjs";

const LAB_SLUG = "storage-public-exposure-audit";
const EXPECTED_IDS = ["no-anonymous-blob-access", "secure-transfer-required", "shared-key-access-disabled"];

let PASS = true;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    PASS = false;
    console.error(`  ✗ ASSERT FAILED: ${msg}`);
  }
}

function summarize(label, result) {
  console.log(`\n  [${label}] gradable=${result.gradable} passed=${result.passed}`);
  for (const c of result.criteria ?? []) {
    const mark = c.unknown ? "?" : c.passed ? "✓" : "✗";
    console.log(`    ${mark} ${c.id}${c.unknown ? " (unknown — check errored)" : ""}`);
  }
}

// Remediate the 3 flaws over the SDK — exactly what the grader checks for:
//   FLAW A allowBlobPublicAccess=true      -> false (+ set container publicAccess None)
//   FLAW B supportsHttpsTrafficOnly=false  -> true
//   FLAW C allowSharedKeyAccess=true       -> false (require Microsoft Entra ID)
async function remediate(ctx) {
  const { StorageManagementClient } = await import("@azure/arm-storage");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const sc = new StorageManagementClient(new DefaultAzureCredential(), ctx.subscriptionId);

  console.log("  remediating account flags (allowBlobPublicAccess=false, httpsOnly=true, allowSharedKeyAccess=false) ...");
  await sc.storageAccounts.update(ctx.resourceGroup, ctx.storageAccountName, {
    allowBlobPublicAccess: false,
    enableHttpsTrafficOnly: true,
    allowSharedKeyAccess: false,
  });

  // Best practice + belt-and-braces for criterion 1: lock the container to no
  // anonymous access too (the account flag alone already makes the anon GET 409,
  // but this matches the remediation the instructions teach).
  console.log("  locking container public-data to publicAccess=None ...");
  const container = ctx.blobContainer || "public-data";
  await sc.blobContainers.update(ctx.resourceGroup, ctx.storageAccountName, container, {
    publicAccess: "None",
  });

  // Belt-and-braces: confirm the container lock actually took. The account flag is
  // the DECISIVE control for the grade, so a mismatch here doesn't change the score,
  // but the smoke test should still surface a container that failed to lock.
  try {
    const props = await sc.blobContainers.get(ctx.resourceGroup, ctx.storageAccountName, container);
    const pa = props?.publicAccess ?? "None";
    assert(pa === "None", `container ${container} publicAccess is None after remediate (got ${pa})`);
  } catch (e) {
    console.warn(`  (container publicAccess re-check skipped: ${e?.message || e})`);
  }
}

// Poll grade() until criterion 1 (no-anonymous-blob-access) flips to a definite
// pass — or the whole grade passes — or the time budget elapses. Absorbs the
// data-plane propagation window so a correctly-fixed account isn't failed by a
// still-caching 200. Returns the last grade result either way (the asserts judge it).
async function gradeWithBackoff(ctx, { budgetMs = 45_000, intervalMs = 5_000 } = {}) {
  const deadline = Date.now() + budgetMs;
  let result = await grade(ctx);
  while (Date.now() < deadline) {
    const c1 = (result.criteria ?? []).find((x) => x.id === "no-anonymous-blob-access");
    // Done as soon as the whole grade passes, or criterion 1 is a definite pass.
    if (result.passed === true) return result;
    if (c1 && c1.passed === true && !c1.unknown) return result;
    const wait = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
    if (wait <= 0) break;
    console.log(`    …anon-access not yet blocked (propagation) — retrying in ${Math.round(wait / 1000)}s`);
    await new Promise((r) => setTimeout(r, wait));
    result = await grade(ctx);
  }
  return result;
}

async function main() {
  console.log(`\n[1/6] lease   lab=${LAB_SLUG}`);
  const leased = await lease("smoke-learner", LAB_SLUG);
  console.log("  ->", JSON.stringify(leased));

  console.log(`\n[2/6] deploy  main.bicep into ${leased.resourceGroup}`);
  const deployed = await deploy(leased);
  console.log("  ->", JSON.stringify({
    storageAccountName: deployed.storageAccountName,
    blobContainer: deployed.blobContainer,
    anonymousBlobUrl: deployed.anonymousBlobUrl,
    usedStack: deployed.usedStack,
  }));

  console.log(`\n[3/6] seedBlob  ${deployed.seedBlobName} -> ${deployed.blobContainer}`);
  const seeded = await seedBlob(deployed);

  console.log(`\n[4/6] grade (BROKEN)  — expect every criterion FALSE`);
  const before = await grade(seeded);
  summarize("broken", before);
  assert(before.gradable === true, "lab is gradable");
  for (const id of EXPECTED_IDS) {
    const c = (before.criteria ?? []).find((x) => x.id === id);
    assert(!!c, `criterion ${id} is present`);
    assert(c && c.passed === false && !c.unknown, `criterion ${id} FAILS on the broken scenario`);
  }
  assert(before.passed === false, "overall grade is NOT passing on the broken scenario");

  console.log(`\n[5/6] remediate  (SDK stands in for the learner's fix)`);
  await remediate(seeded);

  console.log(`\n[5b] grade (FIXED)  — expect every criterion TRUE`);
  // Azure's anonymous data plane can take up to ~30s to STOP serving HTTP 200 after
  // allowBlobPublicAccess flips to false. Grading the instant after remediate() can
  // therefore race that propagation and misreport criterion 1 (control-plane flag
  // reads false but the anon GET still 200s). Poll with backoff until criterion 1
  // flips (or the whole grade passes), up to a bounded budget, instead of one shot.
  const after = await gradeWithBackoff(seeded, { budgetMs: 45_000, intervalMs: 5_000 });
  summarize("fixed", after);
  for (const id of EXPECTED_IDS) {
    const c = (after.criteria ?? []).find((x) => x.id === id);
    assert(c && c.passed === true && !c.unknown, `criterion ${id} PASSES after remediation`);
  }
  assert(after.passed === true, "overall grade PASSES after remediation");

  console.log(`\n[6/6] teardown  delete RG ${seeded.resourceGroup}`);
  await teardown(seeded);

  console.log(`\n========== ${PASS ? "ALL ASSERTIONS PASSED" : "ASSERTIONS FAILED"} ==========`);
  process.exit(PASS ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\n[try-azure-lab] fatal:", e?.stack || e?.message || e);
  process.exit(1);
});
