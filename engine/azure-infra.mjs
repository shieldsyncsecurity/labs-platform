// ShieldSync Labs — Azure Session Engine: azure-infra.mjs (the Azure analog of
// labinfra.mjs / deployStack). Provisions ONE deliberately-broken Storage account
// into a per-session Resource Group, scopes the learner to that RG via a custom
// RBAC role, grades against the account's control-plane flags + an unauthenticated
// data-plane probe, and tears the whole thing down by deleting the RG.
//
// LOCAL-DEV vs PROD. Right now this runs locally (az login OR an env service
// principal) via DefaultAzureCredential. In prod it becomes a worker in the
// platform that authenticates with a managed identity / SP — same code path,
// DefaultAzureCredential just picks up a different source. No credential bridge.
//
// COST MODEL. Standard_LRS StorageV2 + a few-KB blob, no compute / VM / egress.
// Deployment Stacks are free. teardown deletes the whole RG. Everything is ~₹0
// and nothing costs money at idle. Do NOT add a resource that idles non-free.
//
// EXPORTS: lease, deploy, seedBlob, mintAccess, grade, teardown.
//
// ── handler.mjs provider-dispatch snippet (add later; do NOT edit handler.mjs
//    in this build) ────────────────────────────────────────────────────────────
//   Labs carry a `track` in lab.json ("aws" | "azure"). The handler should route
//   the six lifecycle verbs by that track. Sketch (~6 lines) to add to handler.mjs:
//
//     import { deploy as azDeploy, seedBlob as azSeed, grade as azGrade,
//              teardown as azTeardown, mintAccess as azMint } from "./azure-infra.mjs";
//     const trackOf = (labSlug) => labMeta(labSlug).track ?? "aws";           // read lab.json
//     if (trackOf(labSlug) === "azure") { const d = await azDeploy(ctx); await azSeed(d); return d; }
//     // ...and likewise fork grade/teardown/mintConsole on trackOf(s.labSlug).
//
//   (labMeta() lives in labinfra.mjs; extend it to also return `track`.)

import { randomBytes } from "node:crypto";

const DEFAULT_LOCATION = process.env.AZURE_SANDBOX_LOCATION || "eastus";
const LAB_SLUG = "storage-public-exposure-audit";
const LAB_TAG = "ShieldSyncLab"; // teardown-targeting tag key (value = labSlug)

// Whitelist for lab slugs — interpolated into RG names + stack names, so must be safe.
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
function isSafeSlug(s) {
  return typeof s === "string" && SAFE_SLUG.test(s);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var ${name}`);
  return v;
}

// The subscription every sandbox RG is created in. In prod this is the platform's
// dedicated "labs sandbox" subscription; locally it's whatever AZURE_SUBSCRIPTION_ID
// points at. All learner scoping is RG-level, never subscription-level.
function subscriptionId() {
  return requireEnv("AZURE_SUBSCRIPTION_ID");
}

// ── Credential ────────────────────────────────────────────────────────────────
// DefaultAzureCredential chains: env SP (AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET)
// -> managed identity -> az login. Lazy-imported (like graders.mjs lazily imports
// the bedrock client) so this module still loads if @azure/* isn't bundled yet.
let _credential = null;
async function credential() {
  if (_credential) return _credential;
  const { DefaultAzureCredential } = await import("@azure/identity");
  _credential = new DefaultAzureCredential();
  return _credential;
}

// Dedicated READ-ONLY probe credential for grade(). The landing zone provisions a
// separate least-privilege probe SP (AZURE_PROBE_CLIENT_ID/SECRET) so the grader
// runs with a small blast radius rather than the high-privilege mgmt identity that
// deploy/mint/teardown use. When those env vars are present we build a
// ClientSecretCredential from them; otherwise we fall back to DefaultAzureCredential.
let _gradeCredential = null;
async function gradeCredential() {
  if (_gradeCredential) return _gradeCredential;
  const clientId = process.env.AZURE_PROBE_CLIENT_ID;
  const clientSecret = process.env.AZURE_PROBE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_PROBE_TENANT_ID || process.env.AZURE_TENANT_ID;
  if (clientId && clientSecret && tenantId) {
    const { ClientSecretCredential } = await import("@azure/identity");
    _gradeCredential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    return _gradeCredential;
  }
  return credential();
}

// Lazy client factories — each dynamically imports its @azure/arm-* package so a
// missing dep can't break module load (only the verb that needs it fails).
async function resourceClient() {
  const cred = await credential();
  const { ResourceManagementClient } = await import("@azure/arm-resources");
  return new ResourceManagementClient(cred, subscriptionId());
}
async function storageClient() {
  const cred = await credential();
  const { StorageManagementClient } = await import("@azure/arm-storage");
  return new StorageManagementClient(cred, subscriptionId());
}
async function authClient() {
  const cred = await credential();
  const { AuthorizationManagementClient } = await import("@azure/arm-authorization");
  return new AuthorizationManagementClient(cred, subscriptionId());
}

// Short random suffix for RG / stack names (session-scoped uniqueness).
function shortId() {
  return randomBytes(4).toString("hex"); // 8 hex chars
}

// ── lease() ─────────────────────────────────────────────────────────────────
// The Azure analog of the AWS pool lease. AWS hands out a whole disposable ACCOUNT;
// Azure's disposable unit is a RESOURCE GROUP in the shared sandbox subscription —
// created fresh per session, deleted whole at teardown. No pool table to consult:
// the RG *is* the isolation boundary, and RG create/delete is cheap and instant,
// so lease() just mints a unique, tagged, empty RG and returns the session handle
// that deploy/seedBlob/mintAccess/grade/teardown all thread through.
//
// Returns { sessionId, subscriptionId, resourceGroup, location, labSlug }.
export async function lease(userId = "demo-learner", labSlug = LAB_SLUG, location = DEFAULT_LOCATION) {
  if (!isSafeSlug(labSlug)) throw new Error(`unsafe labSlug: ${labSlug}`);
  const sessionId = `sess_${shortId()}`;
  const resourceGroup = `sslab-${labSlug}-${sessionId.replace("sess_", "")}`.slice(0, 90);
  const rc = await resourceClient();
  await rc.resourceGroups.createOrUpdate(resourceGroup, {
    location,
    tags: {
      [LAB_TAG]: labSlug, // teardown targeting — every resource + the RG carry this
      ShieldSyncSession: sessionId,
      ShieldSyncUser: String(userId).slice(0, 128),
    },
  });
  console.log(`  leased RG ${resourceGroup} (${location}) for ${userId} / ${labSlug}`);
  return { sessionId, subscriptionId: subscriptionId(), resourceGroup, location, labSlug };
}

// ── The deliberately-broken template inputs ──────────────────────────────────
// The scenario's three flaws live in main.bicep; deploy() feeds the storage
// account name through as a param so the driver, grader, and blob URL all agree
// on it. Account name = 'sslab' + uniqueString(rg id) in Bicep; we compute the
// SAME deterministic name here so seedBlob/grade can address it WITHOUT a post-
// deploy lookup round-trip if the stack outputs are unavailable. (deploy() still
// prefers the real output when present.)

// ── deploy() ────────────────────────────────────────────────────────────────
// Provision main.bicep into the leased RG as a DEPLOYMENT STACK with
// denySettings.mode = 'denyDelete'. Why a stack (not a plain deployment): the
// deny-assignment it lays down lets the learner REMEDIATE the scenario (write to
// the storage account — flip the flags) but blocks DELETE of the managed
// resources, so they can't "fix" the lab by deleting the broken account. teardown
// removes the stack with unmanageActionResources: 'deleteAll' (which also strips
// the deny-assignment) then deletes the RG.
//
// FALLBACK. Deployment Stacks are exposed via
// ResourceManagementClient.deploymentStacks in recent @azure/arm-resources. If
// that operations group is unavailable in the installed SDK version (it is NOT in
// arm-resources@6.1.0 — the pinned version), we fall back to a plain
// deployments.beginCreateOrUpdateAndWait — the learner then has no deny-delete
// deny-assignment, but the lab is still fully deployable/gradeable.
//
// ── Is the missing deny-delete a real gap? No — it is redundant defense-in-depth. ──
// The PRIMARY control against a learner deleting the scenario is the least-privilege
// learner role (lab.json -> learnerRole): it grants storageAccounts READ + WRITE (so
// they can remediate) but NO */delete action and no subscription-scope action, so a
// learner simply CANNOT delete the account/container regardless of any deny-assignment
// (this is the same model the AWS labs use). And even if they could, a DELETED account
// grades as FAIL (the grader can't read the flags), so deletion never helps them pass.
// The Deployment Stack deny-assignment would only add belt-and-braces. OPTIONAL
// HARDENING (tracked): @azure/arm-resourcesdeploymentstacks@2.0.0 now ships the stacks
// client as a standalone package — wiring deploy()/teardown() to it would restore the
// deny-assignment. Not done here: it is a redundant control, and it needs re-validating
// that the mgmt SP (Contributor + scoped RBAC-admin) is permitted to lay a
// denyAssignment, which Contributor alone does not obviously allow.
//
// Returns { sessionId, resourceGroup, storageAccountName, blobContainer,
//           seedBlobName, anonymousBlobUrl, usedStack }.
export async function deploy(ctx) {
  const { sessionId, resourceGroup, location = DEFAULT_LOCATION, labSlug = LAB_SLUG } = ctx;
  if (!resourceGroup) throw new Error("deploy: ctx.resourceGroup required (call lease first)");
  if (!isSafeSlug(labSlug)) throw new Error(`unsafe labSlug: ${labSlug}`);

  const template = await loadBicepAsArm(labSlug);
  const parameters = { location: { value: location }, labSlug: { value: labSlug } };
  const rc = await resourceClient();

  const stackName = `sslab-${labSlug}-${sessionId.replace("sess_", "")}`.slice(0, 90);
  let outputs = null;
  let usedStack = false;

  if (rc.deploymentStacks && typeof rc.deploymentStacks.beginCreateOrUpdateAtResourceGroupAndWait === "function") {
    console.log(`  deploying Deployment Stack ${stackName} (denyDelete) into ${resourceGroup} ...`);
    const stack = await rc.deploymentStacks.beginCreateOrUpdateAtResourceGroupAndWait(
      resourceGroup,
      stackName,
      {
        location,
        properties: {
          template,
          parameters,
          // denyDelete: learner may WRITE (remediate the flags) but not DELETE the
          // scenario resources. 'denyDelete' vs 'denyWriteAndDelete' — the latter
          // would block the remediation itself, so it MUST be denyDelete here.
          denySettings: { mode: "denyDelete", applyToChildScopes: true },
          // On unmanage (i.e. teardown deletes the stack): remove EVERYTHING the
          // stack manages — resources + the RG-scope management + the deny-assignment.
          actionOnUnmanage: {
            resources: "delete",
            resourceGroups: "delete",
            managementGroups: "delete",
          },
        },
        tags: { [LAB_TAG]: labSlug, ShieldSyncSession: sessionId },
      }
    );
    outputs = stack?.properties?.outputs ?? null;
    usedStack = true;
  } else {
    // Plain-deployment fallback (arm-resources@6.1.0 exposes no deploymentStacks group).
    // The learner then gets no deny-delete deny-assignment -- which is ACCEPTABLE, not a
    // silent gap: the least-privilege learner role has no */delete action (the PRIMARY
    // control), and a deleted account grades as fail anyway (see the deploy() header). So
    // we WARN and PROCEED rather than throw. (Earlier this threw when NODE_ENV=production
    // -- a latent foot-gun that would have broken a perfectly acceptable deploy the moment
    // NODE_ENV got set; removed deliberately.) ALLOW_NO_STACK=1 just silences the warning.
    if (process.env.ALLOW_NO_STACK !== "1") {
      console.warn(
        "  [azure-infra] deploymentStacks unavailable (arm-resources@6.1.0) -> plain deployment, no " +
          "deny-delete deny-assignment. Acceptable: the least-privilege learner role has no delete action. " +
          "Optional hardening: @azure/arm-resourcesdeploymentstacks@2.0.0."
      );
    }
    const dep = await rc.deployments.beginCreateOrUpdateAndWait(resourceGroup, stackName, {
      properties: { mode: "Incremental", template, parameters },
      tags: { [LAB_TAG]: labSlug, ShieldSyncSession: sessionId },
    });
    outputs = dep?.properties?.outputs ?? null;
  }

  // Prefer the real output; else recompute from the deterministic naming used in
  // main.bicep (sslab + uniqueString(rg id)). If the stack didn't surface an
  // output, look the account up by tag so we never guess wrong.
  let storageAccountName = outputs?.storageAccountName?.value ?? null;
  // main.bicep names this output 'containerName' — read that (not 'blobContainer',
  // which never exists and silently falls through to the literal default).
  let blobContainer = outputs?.containerName?.value ?? "public-data";
  if (!storageAccountName) storageAccountName = await findStorageAccountByTag(resourceGroup, labSlug);
  if (!storageAccountName) throw new Error("deploy: could not resolve the deployed storage account name from outputs or tag");

  const seedBlobName = "customer-export.csv";
  const anonymousBlobUrl =
    outputs?.anonymousBlobUrl?.value ??
    `https://${storageAccountName}.blob.core.windows.net/${blobContainer}/${seedBlobName}`;

  console.log(`  deployed storage account ${storageAccountName} (container ${blobContainer})`);
  return {
    ...ctx,
    stackName,
    storageAccountName,
    blobContainer,
    seedBlobName,
    anonymousBlobUrl,
    usedStack,
  };
}

// Read main.bicep and hand ARM the template. az CLI (bicep build) is NOT available
// in this build/deploy env, so we support two shapes:
//   1) a precompiled main.json sitting next to main.bicep (preferred for prod —
//      the user's scripted deploy runs `az bicep build` once and commits it), OR
//   2) main.bicep, which we pass through only if the installed SDK/runtime can
//      compile it. When neither a JSON template nor a Bicep compiler is present we
//      throw a clear, actionable error rather than deploying something empty.
async function loadBicepAsArm(labSlug) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  // Prod (Lambda) bundles the labs/ tree next to this module (here/labs); locally
  // it lives at the repo root (here/../labs). Try both so the same code path works
  // in the deployed function AND in a local `node try-azure-lab.mjs` run.
  const candidates = [join(here, "labs", labSlug), join(here, "..", "labs", labSlug)];
  const labDir = candidates.find((d) => existsSync(join(d, "main.json"))) ?? candidates[0];
  const jsonPath = join(labDir, "main.json");
  const bicepPath = join(labDir, "main.bicep");
  if (existsSync(jsonPath)) {
    return JSON.parse(readFileSync(jsonPath, "utf8"));
  }
  throw new Error(
    `no compiled ARM template found for ${labSlug}. Run 'az bicep build --file ${bicepPath} --outfile ${jsonPath}' ` +
      `(or 'bicep build') and commit main.json next to main.bicep; the engine deploys the JSON, not the .bicep source.`
  );
}

// Find the account created by the stack via the ShieldSyncLab tag (belt-and-braces
// when a stack output isn't surfaced).
async function findStorageAccountByTag(resourceGroup, labSlug) {
  const sc = await storageClient();
  for await (const acct of sc.storageAccounts.listByResourceGroup(resourceGroup)) {
    if (acct?.tags?.[LAB_TAG] === labSlug && acct?.name) return acct.name;
  }
  // Fallback: first account in the RG (the scenario deploys exactly one).
  for await (const acct of sc.storageAccounts.listByResourceGroup(resourceGroup)) {
    if (acct?.name) return acct.name;
  }
  return null;
}

// ── seedBlob() ──────────────────────────────────────────────────────────────
// The "secret" object is NOT created by Bicep (keeps the template free/pure) — the
// driver uploads it post-deploy over the data plane. We authenticate with the SP /
// AAD token (Storage Blob Data Contributor on the account, granted to the engine
// identity) rather than an account key, so no listKeys is ever needed.
//
// Uses the raw blob REST PUT (x-ms-blob-type: BlockBlob) with an AAD bearer token
// from the same DefaultAzureCredential — avoids adding @azure/storage-blob as a
// dependency just for one upload. Idempotent (PUT overwrites).
export async function seedBlob(ctx) {
  const { storageAccountName, blobContainer = "public-data", seedBlobName = "customer-export.csv" } = ctx;
  if (!storageAccountName) throw new Error("seedBlob: ctx.storageAccountName required (call deploy first)");

  // SYNTHETIC DATA ONLY — fictional names/emails and non-real card_last4 values
  // (no live PII/PCI). Present so the anonymous-exposure lesson has a plausible
  // "secret" to leak; may trip DLP false-positives in a shared sandbox subscription.
  const body =
    "customer_id,email,full_name,card_last4,export_ts\n" +
    "1001,alice@example.com,Alice Menon,4242,2026-07-07T00:00:00Z\n" +
    "1002,ravi@example.com,Ravi Shankar,1881,2026-07-07T00:00:00Z\n" +
    "1003,mei@example.com,Mei Chen,9004,2026-07-07T00:00:00Z\n";

  const cred = await credential();
  // Storage data-plane AAD scope.
  const token = await cred.getToken("https://storage.azure.com/.default");
  if (!token?.token) throw new Error("seedBlob: could not acquire a storage.azure.com token");

  const url = `https://${storageAccountName}.blob.core.windows.net/${blobContainer}/${encodeURIComponent(seedBlobName)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      method: "PUT",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token.token}`,
        "x-ms-version": "2021-08-06",
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "text/csv",
        "Content-Length": String(Buffer.byteLength(body)),
      },
      body,
    });
    if (!(res.status === 201 || res.status === 200)) {
      const txt = await res.text().catch(() => "");
      throw new Error(`seedBlob: PUT ${url} -> HTTP ${res.status} ${txt.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
  console.log(`  seeded ${seedBlobName} into ${blobContainer} (${storageAccountName})`);
  return {
    ...ctx,
    anonymousBlobUrl:
      ctx.anonymousBlobUrl ||
      `https://${storageAccountName}.blob.core.windows.net/${blobContainer}/${seedBlobName}`,
  };
}

// ── mintAccess() ────────────────────────────────────────────────────────────
// The Azure analog of AWS mintConsoleUrl's least-privilege scoping. Creates the
// lab's CUSTOM RBAC ROLE (from lab.json's learnerRole) scoped to the session RG
// ONLY, then assigns it to the learner principal. Grants exactly the actions the
// remediation needs (read the RG + storage account, WRITE the storage account to
// flip the flags, read blob data to verify) and NOTHING else — no *delete*, no
// Microsoft.Authorization/*/write, no listKeys, no subscription-scope action.
//
// principalId = the AAD object id of the human learner (or their per-session
// guest/ephemeral principal). In local dev you can pass your own object id.
// Returns { roleDefinitionId, roleAssignmentId, portalUrl }.
export async function mintAccess(ctx) {
  const { resourceGroup, principalId, labSlug = LAB_SLUG } = ctx;
  if (!resourceGroup) throw new Error("mintAccess: ctx.resourceGroup required");
  if (!principalId) throw new Error("mintAccess: ctx.principalId (learner AAD object id) required");

  const learnerRole = await loadLearnerRole(labSlug);
  const sub = subscriptionId();
  const rgScope = `/subscriptions/${sub}/resourceGroups/${resourceGroup}`;

  const ac = await authClient();
  const { randomUUID } = await import("node:crypto");

  // Custom role definition — scoped assignable to THIS RG only. Name must be unique
  // per definition; suffix with the RG so parallel sessions don't collide.
  const roleDefId = randomUUID();
  const roleName = learnerRole.roleName || `ShieldSyncLabLearner-${resourceGroup}`.slice(0, 512);
  // lab.json stores the grant NESTED + lower-cased under
  // learnerRole.permissions[0].{actions,notActions,dataActions,notDataActions}
  // (NOT top-level capitalised Actions/NotActions). Read the real shape, else the
  // minted role gets an EMPTY permission set and the learner can't remediate.
  const perm = (learnerRole.permissions && learnerRole.permissions[0]) || {};
  // NOTE: learnerRole.assignableScopes in lab.json is a decorative <SUB_ID>/<RG>
  // placeholder — the driver OVERRIDES it with the real per-session rgScope here.
  await ac.roleDefinitions.createOrUpdate(rgScope, roleDefId, {
    roleName,
    description:
      learnerRole.description ||
      learnerRole._learnerRole ||
      "ShieldSync lab learner — RG-scoped least privilege.",
    roleType: "CustomRole",
    permissions: [
      {
        actions: perm.actions ?? [],
        notActions: perm.notActions ?? [],
        dataActions: perm.dataActions ?? [],
        notDataActions: perm.notDataActions ?? [],
      },
    ],
    assignableScopes: [rgScope], // ALWAYS this RG, NEVER the subscription (lab.json placeholder ignored on purpose)
  });
  const roleDefinitionId = `${rgScope}/providers/Microsoft.Authorization/roleDefinitions/${roleDefId}`;

  // Assign it to the learner at the RG scope.
  const assignmentId = randomUUID();
  const assignment = await ac.roleAssignments.create(rgScope, assignmentId, {
    roleDefinitionId,
    principalId,
    principalType: "User",
  });

  const portalUrl = `https://portal.azure.com/#@/resource${rgScope}/overview`;
  console.log(`  minted RG-scoped learner role for ${principalId} on ${resourceGroup}`);
  // roleDefId is threaded back so teardown() can delete the custom role DEFINITION
  // (a subscription-level object that RG-delete does NOT remove — it would orphan).
  return { ...ctx, roleDefinitionId, roleDefId, roleAssignmentId: assignment?.id ?? assignmentId, portalUrl };
}

async function loadLearnerRole(labSlug) {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const labJson = JSON.parse(readFileSync(join(here, "labs", labSlug, "lab.json"), "utf8"));
  const r = labJson.learnerRole;
  if (!r) throw new Error(`lab.json for ${labSlug} has no learnerRole`);
  return { ...r, _learnerRole: labJson._learnerRole };
}

// ── grade() ─────────────────────────────────────────────────────────────────
// Delegates to graders.azure.mjs (authored separately) so scoring logic lives in
// ONE place. Passes the ctx it needs: credential + subscription + RG + account +
// the anonymous blob URL for the data-plane probe.
export async function grade(ctx) {
  const { gradeAzureLab } = await import("./graders.azure.mjs");
  const cred = await gradeCredential();
  return gradeAzureLab(ctx.labSlug || LAB_SLUG, {
    credential: cred,
    subscriptionId: ctx.subscriptionId || subscriptionId(),
    resourceGroup: ctx.resourceGroup,
    storageAccountName: ctx.storageAccountName,
    anonymousBlobUrl: ctx.anonymousBlobUrl,
  });
}

// ── teardown() ──────────────────────────────────────────────────────────────
// FULL WIPE. Delete the Deployment Stack with unmanageActionResources: 'deleteAll'
// (removes the managed resources AND the deny-assignment so the RG delete can
// proceed), then delete the RG (removes anything out-of-band the stack didn't
// manage — e.g. the seeded blob, the custom role assignment). RG delete is the
// hard guarantee that nothing is left billing.
//
// Idempotent + absence-tolerant: a stack/RG that's already gone is success, not an
// error (mirrors the AWS teardown's absence handling).
export async function teardown(ctx) {
  const { resourceGroup, stackName, roleDefId } = ctx;
  if (!resourceGroup) throw new Error("teardown: ctx.resourceGroup required");
  const rc = await resourceClient();
  const sub = subscriptionId();
  const rgScope = `/subscriptions/${sub}/resourceGroups/${resourceGroup}`;

  // 0) Delete the custom role DEFINITION minted per-lease by mintAccess. It is a
  //    subscription-level object (not an RG child), so deleting the RG below does
  //    NOT remove it — leaving one orphan definition per session. Absence-tolerant.
  if (roleDefId) {
    try {
      console.log(`  deleting custom learner role definition ${roleDefId} ...`);
      const ac = await authClient();
      await ac.roleDefinitions.delete(rgScope, roleDefId);
    } catch (e) {
      if (!isAbsenceError(e)) {
        console.warn(`  role-definition delete failed (${e.message}) — continuing with RG delete`);
      }
    }
  }

  // 1) Delete the stack (best-effort; if stacks weren't used or it's already gone,
  //    skip straight to the RG delete which is the authoritative cleanup).
  if (stackName && rc.deploymentStacks && typeof rc.deploymentStacks.beginDeleteAtResourceGroupAndWait === "function") {
    try {
      console.log(`  deleting Deployment Stack ${stackName} (deleteAll) ...`);
      await rc.deploymentStacks.beginDeleteAtResourceGroupAndWait(resourceGroup, stackName, {
        unmanageActionResources: "delete",
        unmanageActionResourceGroups: "delete",
        unmanageActionManagementGroups: "delete",
      });
    } catch (e) {
      if (!isAbsenceError(e)) {
        console.warn(`  stack delete failed (${e.message}) — falling through to RG delete`);
      }
    }
  }

  // 2) Delete the whole RG — the authoritative wipe. Absence = already clean.
  try {
    console.log(`  deleting resource group ${resourceGroup} ...`);
    await rc.resourceGroups.beginDeleteAndWait(resourceGroup);
  } catch (e) {
    if (isAbsenceError(e)) {
      console.log(`  RG ${resourceGroup} already gone — nothing to do`);
      return { resourceGroup, deleted: true, alreadyGone: true };
    }
    throw e;
  }
  console.log(`  torn down ${resourceGroup}`);
  return { resourceGroup, deleted: true };
}

// Azure "not found" (RG/stack already deleted) is a valid clean state, not an
// error — mirror graders.mjs's ABSENCE_ERRORS discipline so teardown is idempotent.
function isAbsenceError(e) {
  const code = e?.code || e?.name || e?.statusCode || "";
  const status = e?.statusCode ?? e?.response?.status;
  if (status === 404) return true;
  return /ResourceGroupNotFound|ResourceNotFound|NotFound|DeploymentStackNotFound/i.test(String(code));
}
