// ShieldSync Labs — Azure auto-grader. Sibling of graders.mjs (AWS). For a live
// Azure lab session, inspect the REAL resource-group state with the session's
// credential and score it against the lab's successCriteria (authored in each
// lab.json). Read-only.
//
// The @azure/* clients are imported LAZILY inside each grader (mirroring how
// graders.mjs lazy-imports @aws-sdk/client-bedrock) so this module still loads
// even if the Azure SDK isn't in the engine bundle yet — no fail-at-load while
// the Azure track is pre-`ready`. Make them top-level imports once the clients
// are confirmed bundled and the lab is live-tested.
//
// ctx carries { credential, subscriptionId, resourceGroup, storageAccountName,
// anonymousBlobUrl }. `credential` is a @azure/identity TokenCredential (the
// session's scoped SP / DefaultAzureCredential from azure-infra.mjs).

// ── absence-vs-real-error discipline (mirrors graders.mjs) ───────────────────
// Azure errors that genuinely mean "the resource isn't there" — i.e. a valid
// fixed/clean state (e.g. the learner deleted a scenario resource, or a probe
// hit a name that no longer resolves). ANYTHING else (throttling 429,
// AuthorizationFailed, network) means the check itself FAILED: we must NOT
// report a green pass off a failed call, or a transient blip reads as "you
// fixed it". Such criteria are marked `unknown`.
const ABSENCE_STATUS = new Set([404]);
const ABSENCE_CODES = new Set([
  "ResourceNotFound",
  "ResourceGroupNotFound",
  "StorageAccountNotFound",
  "NotFound",
  "ParentResourceNotFound",
]);
function isAbsenceError(e) {
  if (!e) return false;
  const status = e.statusCode ?? e.status ?? e.response?.status;
  if (status != null && ABSENCE_STATUS.has(Number(status))) return true;
  const code = e.code || e.name || e.body?.code || e.details?.code || "";
  if (ABSENCE_CODES.has(code)) return true;
  return [...ABSENCE_CODES].some((n) => String(code).includes(n));
}
// Spread into a criterion to flag "couldn't verify" when a non-absence error hit.
const unk = (err) => (err ? { unknown: true } : {});

// ── Storage account public exposure & data leak ──────────────────────────────
// Grades the "storage-public-exposure-audit" lab. Three criteria, ids LOAD-
// BEARING (must match successCriteria in lab.json exactly):
//   no-anonymous-blob-access | secure-transfer-required | minimum-tls-1-2
export async function gradeStoragePublicExposure(ctx) {
  const { StorageManagementClient } = await import("@azure/arm-storage");

  const { credential, subscriptionId, resourceGroup, storageAccountName, anonymousBlobUrl } = ctx;

  // ── control-plane flags (one getProperties call feeds all 3 criteria) ──────
  let account = null;
  let acctErr = null; // non-absence error → the account-flag criteria are `unknown`
  try {
    const client = new StorageManagementClient(credential, subscriptionId);
    account = await client.storageAccounts.getProperties(resourceGroup, storageAccountName);
  } catch (e) {
    // A 404 / ResourceNotFound here means the account is gone. The lab grades
    // fixing-in-place, not deletion, so a missing account can't be a "pass" for
    // any flag criterion — leave account=null (criteria fail) but do NOT mark
    // `unknown`, since absence is a determinate (if wrong) state, not a failed
    // probe. Any OTHER error is a real probe failure → `unknown`.
    if (!isAbsenceError(e)) acctErr = e;
  }

  // allowBlobPublicAccess: Azure treats an unset value as `true` (public allowed),
  // so an explicit === false is required to pass. Same defensive read for the
  // other two flags.
  const allowPublic = account?.allowBlobPublicAccess;   // want === false
  const httpsOnly = account?.enableHttpsTrafficOnly;    // want === true
  const minTls = account?.minimumTlsVersion;            // want === 'TLS1_2'

  // ── criterion 1 data-plane probe: unauthenticated HTTPS GET on the seed blob ─
  // Resource Graph / control-plane can't PROVE the blob is truly unreadable —
  // container-level anonymous access can leak even with the account flag set in
  // some intermediate states — so the data-plane GET is authoritative. Pass
  // criterion 1 only if the flag is false AND that anonymous GET is authoritatively
  // BLOCKED (403/409), not merely "any non-200".
  //
  // PROPAGATION WINDOW: after allowBlobPublicAccess flips to false, Azure's
  // anonymous data plane can take up to ~30s to STOP serving HTTP 200. A "Check my
  // work" click (or CI grade) fired the instant after saving can therefore still
  // see a 200 and read as "not yet fixed" — this is a propagation race, not a wrong
  // answer. Callers that grade immediately after a remediation should poll/retry for
  // a short budget (see try-azure-lab.mjs) rather than trusting one shot.
  let anonStatus = null;
  let probeErr = null; // ambiguous fault on the probe → criterion 1 is `unknown`
  if (anonymousBlobUrl) {
    try {
      // No auth header at all — this is exactly the anonymous-attacker request.
      const res = await fetch(anonymousBlobUrl, { method: "GET", redirect: "manual" });
      anonStatus = res.status;
      // Drain/close the body so the socket doesn't dangle.
      try { await res.arrayBuffer(); } catch { /* body may be empty/blocked */ }
    } catch (e) {
      // A network-layer throw (DNS, TLS reset) is ambiguous — it is NOT proof the
      // blob is private (could be a transient blip), so mark the probe unknown
      // rather than silently passing.
      probeErr = e;
    }
  } else {
    // No blob URL supplied → we cannot run the authoritative data-plane check.
    probeErr = new Error("anonymousBlobUrl not provided to grader");
  }

  // Classify the anonymous GET precisely rather than "any non-200 == blocked":
  //   200            -> still leaking (fail)
  //   403 / 409      -> anonymous access denied (PublicAccessNotPermitted) — blocked
  //   5xx            -> transient server error — can't prove anything -> unknown
  //   404            -> blob/container gone or stale URL — can't prove THIS control
  //                     actually worked -> unknown (not a pass)
  //   other 4xx      -> treat conservatively as unknown
  // A bare non-200 (e.g. a transient 503) must NOT count as "you fixed it".
  let anonBlocked = false;      // true only on an authoritative deny
  let probeAmbiguous = false;   // 5xx / 404 / unexpected → criterion 1 unknown
  if (anonStatus === 200) {
    anonBlocked = false;
  } else if (anonStatus === 403 || anonStatus === 409) {
    anonBlocked = true;
  } else if (anonStatus != null) {
    // 5xx, 404, or any other non-authoritative response.
    probeAmbiguous = true;
  }

  // criterion 1 is unknown if the account read errored, the probe threw, OR the
  // probe returned an ambiguous status we can't score a pass/fail off.
  const criterion1Unknown = !!(acctErr || probeErr) || probeAmbiguous;
  const noAnonymousPass = !criterion1Unknown && allowPublic === false && anonBlocked;

  return [
    {
      id: "no-anonymous-blob-access",
      description: "The storage account blocks anonymous/public blob access.",
      passed: noAnonymousPass,
      ...(criterion1Unknown ? { unknown: true } : {}),
    },
    {
      id: "secure-transfer-required",
      description: "Secure transfer (HTTPS-only) is required on the account.",
      passed: httpsOnly === true,
      ...unk(acctErr),
    },
    {
      id: "minimum-tls-1-2",
      description: "The account enforces a minimum TLS version of 1.2.",
      passed: minTls === "TLS1_2",
      ...unk(acctErr),
    },
  ];
}

/**
 * gradeAzureLab(): dispatch to the per-lab Azure grader.
 * Returns { gradable, criteria: [{id, description, passed, unknown?}], passed }.
 * Overall pass requires every criterion verified passing — an `unknown` (a check
 * that couldn't run) never counts as a pass (mirrors gradeLab in graders.mjs).
 */
export async function gradeAzureLab(labSlug, ctx) {
  let criteria = null;
  if (labSlug === "storage-public-exposure-audit") {
    criteria = await gradeStoragePublicExposure(ctx);
  }
  if (!criteria) return { gradable: false, criteria: [], passed: false };
  return {
    gradable: true,
    criteria,
    passed: criteria.every((x) => x.passed === true && !x.unknown),
  };
}
