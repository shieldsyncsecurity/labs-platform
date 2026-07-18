# Runs in Windows PowerShell 5.1+ or PowerShell 7 (no v7-only syntax; ASCII-only).
<#
    ShieldSync Labs - Azure landing-zone setup  (ONE-TIME, per account)
    ===================================================================
    The Azure analog of the AWS infra/ setup. Creates, in ONE sponsored subscription:
      1. (OPTIONAL, default OFF) a pool of resource groups. VESTIGIAL: the engine's
         azure-infra.lease() mints a DYNAMIC RG per session and ignores any pool. -PoolSize 0.
      2. A management service principal  (shieldsync-lab-mgmt)  - the engine's deploy/teardown identity.
      3. A read-only probe service principal (shieldsync-lab-probe) - the grader's read-only identity.
      4. The custom RBAC role the mgmt SP is allowed to assign to learners (assignment happens per-lease).
      5. The "deny expensive" Azure Policy (from deny-expensive-policy.json) assigned at the sub scope.

    DESIGN
      - DYNAMIC RESOURCE GROUP per session in one sub (not a pre-created pool, not many subs). The RG is
        the teardown unit; azure-infra.lease() creates it and teardown() deletes it.
      - LEAST PRIVILEGE, split by blast radius: mgmt SP can write + create RGs across this ONE dedicated,
        deny-policy-fenced labs sub + can only assign the ONE learner role; probe SP is Reader-only.
        Neither is Owner. (Sub scope is required BECAUSE the session RG name isn't known ahead of time.)
      - COST: RGs, SPs, roles, role assignments and policy assignments are all free at idle.

    IDEMPOTENT: safe to re-run. It reconciles to desired state - it will NOT create duplicate SPs,
    roles, RGs, or policy assignments. Re-running with a larger -PoolSize only ADDS missing RGs.

    THIS SCRIPT DOES NOT RUN IN THE BUILD ENVIRONMENT. The user runs it against a real subscription.

    PREREQS: az CLI >= 2.60 logged in as Owner of the sub; pwsh 7+.
    USAGE:
      pwsh ./setup-landing-zone.ps1 -SubscriptionId <SUB_ID> -PoolSize 5 -Location eastus
      pwsh ./setup-landing-zone.ps1 -SubscriptionId <SUB_ID> -RotateSecrets   # re-issue SP secrets
#>

[CmdletBinding()]
param(
    # The sponsored (Microsoft-for-Startups) subscription that backs all Azure labs.
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    # DEPRECATED pre-created RG pool. The engine's azure-infra.lease() mints a DYNAMIC
    # resource group per session (sslab-<slug>-<hex>) and NEVER consults a pool, so the
    # default is now 0 (no vestigial pool). The SP grants below are at SUBSCRIPTION scope
    # to match that dynamic-RG model. Set >0 only for optional manual/legacy pooling.
    [int]$PoolSize = 0,

    # Region for the RG pool + the allowed-locations lock. Must match the labs' deploysToRegion.
    [string]$Location = "eastus",

    # Prefix for the pooled resource groups: ss-lab-pool-001, -002, ...
    [string]$RgPrefix = "ss-lab-pool",

    # Service principal display names.
    [string]$MgmtSpName  = "shieldsync-lab-mgmt",
    [string]$ProbeSpName = "shieldsync-lab-probe",

    # Custom role name the mgmt SP is allowed to assign to learners at lease-time.
    [string]$LearnerRoleName = "ShieldSync Lab Learner - Storage",

    # If set, re-issue (rotate) both SP secrets even if the SPs already exist.
    [switch]$RotateSecrets
)

# Fail fast on any error; treat native az non-zero exits as terminating.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$policyFile = Join-Path $scriptDir "deny-expensive-policy.json"

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    ok: $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "    skip (exists): $msg" -ForegroundColor DarkGray }

# az emits JSON on stdout; wrap so a native failure becomes a PowerShell terminating error.
function Invoke-Az {
    # NB: no declared param + no [CmdletBinding] on purpose. If this were an advanced
    # function, PowerShell would try to bind single-dash az flags like -o/-g as common
    # parameters (-OutVariable/-OutBuffer) and fail ("parameter 'o' is ambiguous").
    # Using the automatic $args passes every token straight through to az verbatim.
    $out = & az @args
    if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $out
}

# ---------------------------------------------------------------------------
# 0. Context + provider registration
# ---------------------------------------------------------------------------
Write-Step "Selecting subscription $SubscriptionId"
Invoke-Az account set --subscription $SubscriptionId | Out-Null
$acct     = Invoke-Az account show -o json | ConvertFrom-Json
$tenantId = $acct.tenantId
Write-Ok "tenant $tenantId"

Write-Step "Registering required resource providers (idempotent)"
foreach ($ns in @("Microsoft.Storage", "Microsoft.Authorization", "Microsoft.Resources")) {
    $state = (Invoke-Az provider show -n $ns --query registrationState -o tsv)
    if ($state -ne "Registered") {
        Invoke-Az provider register -n $ns | Out-Null
        Write-Ok "registering $ns (may take a minute; deploy will wait)"
    } else {
        Write-Skip $ns
    }
}

# ---------------------------------------------------------------------------
# 1. Resource-group pool  (OPTIONAL/VESTIGIAL - default PoolSize 0)
# ---------------------------------------------------------------------------
# The engine mints a DYNAMIC RG per session (azure-infra.lease -> sslab-<slug>-<hex>) and
# never reads a pool, so this loop is a no-op at the default PoolSize 0. Left in only for
# optional manual pooling; the SP grants below are subscription-scoped regardless.
if ($PoolSize -gt 0) { Write-Step "Ensuring $PoolSize pooled resource groups ($RgPrefix-NNN) in $Location" }
for ($i = 1; $i -le $PoolSize; $i++) {
    $rg = "{0}-{1:D3}" -f $RgPrefix, $i
    $exists = (Invoke-Az group exists -n $rg)   # returns "true"/"false"
    if ($exists -eq "true") {
        Write-Skip $rg
    } else {
        # Tag the RG so pool discovery + the deny fence + cost reports can target it.
        Invoke-Az group create -n $rg -l $Location `
            --tags "ShieldSyncLabPool=1" "managedBy=shieldsync-lab-mgmt" | Out-Null
        Write-Ok $rg
    }
}
$subScope = "/subscriptions/$SubscriptionId"

# ---------------------------------------------------------------------------
# 2. Custom learner role (definition only; the mgmt SP assigns it per-lease)
# ---------------------------------------------------------------------------
# This is the SAME least-privilege model as engine/labs/<slug>/lab.json -> learnerRole, but registered
# once at the subscription as an assignable custom role. assignableScopes is the whole sub so the mgmt
# SP can scope each ASSIGNMENT down to a single learner RG at lease-time.
Write-Step "Ensuring custom learner role '$LearnerRoleName'"
$existingRole = (& az role definition list --name $LearnerRoleName --query "[0].name" -o tsv 2>$null)
$learnerRoleDef = @{
    Name             = $LearnerRoleName
    Description      = "ShieldSync Labs learner - read/write Storage + blob containers, blob data-read; NO delete, NO key list, NO role writes, NO subscription-scope actions. Assigned scoped to a single lease RG."
    IsCustom         = $true
    Actions          = @(
        "Microsoft.Resources/subscriptions/resourceGroups/read",
        "Microsoft.Storage/storageAccounts/read",
        "Microsoft.Storage/storageAccounts/write",
        "Microsoft.Storage/storageAccounts/blobServices/read",
        "Microsoft.Storage/storageAccounts/blobServices/write",
        "Microsoft.Storage/storageAccounts/blobServices/containers/read",
        "Microsoft.Storage/storageAccounts/blobServices/containers/write",
        "Microsoft.Authorization/roleAssignments/read",
        "Microsoft.Authorization/roleDefinitions/read"
    )
    NotActions       = @()
    DataActions      = @(
        "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read"
    )
    NotDataActions   = @()
    AssignableScopes = @($subScope)
}
$roleJsonPath = Join-Path ([System.IO.Path]::GetTempPath()) "ss-learner-role.json"
$learnerRoleDef | ConvertTo-Json -Depth 8 | Set-Content -Path $roleJsonPath -Encoding ascii
if ([string]::IsNullOrWhiteSpace($existingRole)) {
    Invoke-Az role definition create --role-definition $roleJsonPath | Out-Null
    Write-Ok "created learner role"
} else {
    # Reconcile the definition in place so re-runs pick up action edits.
    Invoke-Az role definition update --role-definition $roleJsonPath | Out-Null
    Write-Ok "updated learner role"
}
Remove-Item $roleJsonPath -ErrorAction SilentlyContinue

# A custom role definition takes a few seconds to become queryable across RBAC replicas.
# Fetch its id ONCE here (with a short retry) so the mgmt SP's RBAC-admin condition below
# always has a valid GUID - querying it per-iteration hit an empty result under eventual
# consistency and produced an invalid ({}) condition.
$learnerRoleId = ""
for ($r = 0; $r -lt 24; $r++) {
    $learnerRoleId = (& az role definition list --name $LearnerRoleName --query "[0].name" -o tsv 2>$null)
    if (-not [string]::IsNullOrWhiteSpace($learnerRoleId)) { break }
    Start-Sleep -Seconds 5
}
if ([string]::IsNullOrWhiteSpace($learnerRoleId)) { throw "learner role '$LearnerRoleName' did not become queryable in time (RBAC propagation)" }
Write-Ok "learner role id $learnerRoleId"

# ---------------------------------------------------------------------------
# 3. Service principals  (mgmt = write-on-pool; probe = read-only)
# ---------------------------------------------------------------------------
# Helper: find an existing SP appId by display name (empty string if none).
function Get-SpAppId([string]$name) {
    return (& az ad sp list --display-name $name --query "[0].appId" -o tsv 2>$null)
}

# --- 3a. Management SP: Contributor on each pool RG + can assign ONLY the learner role. ----------
Write-Step "Ensuring management SP '$MgmtSpName'"
$mgmtAppId  = Get-SpAppId $MgmtSpName
$mgmtSecret = $null
if ([string]::IsNullOrWhiteSpace($mgmtAppId)) {
    # Create WITHOUT a role first, then scope roles to the RGs (not the whole sub) below.
    $sp = Invoke-Az ad sp create-for-rbac --name $MgmtSpName --skip-assignment -o json | ConvertFrom-Json
    $mgmtAppId  = $sp.appId
    $mgmtSecret = $sp.password
    Write-Ok "created mgmt SP $mgmtAppId"
} else {
    Write-Skip "mgmt SP $mgmtAppId"
    if ($RotateSecrets) {
        $mgmtSecret = (Invoke-Az ad sp credential reset --id $mgmtAppId --query password -o tsv)
        Write-Ok "rotated mgmt SP secret"
    }
}
# The engine mints a DYNAMIC RG per session (name not known ahead of time), so the mgmt SP
# MUST be scoped at the SUBSCRIPTION - it has to create + write resource groups anywhere in
# this dedicated, deny-policy-fenced labs sub. (Pool-RG-scoped grants could never cover an
# as-yet-unnamed session RG.) Wider blast radius than pool-scoping, but bounded to one throwaway
# labs subscription + the deny-expensive policy. This matches the LIVE landing zone.
Write-Step "Assigning mgmt SP -> Contributor + Storage Blob Data Contributor + scoped RBAC-admin at subscription"
Invoke-Az role assignment create --assignee $mgmtAppId --role "Contributor" --scope $subScope | Out-Null
# seedBlob() uploads the "secret" object via an AAD token (a DATA-plane write), and Contributor
# (control plane) does NOT include blob-data write - so the mgmt SP also needs Storage Blob Data
# Contributor. Without this, seedBlob 403s.
Invoke-Az role assignment create --assignee $mgmtAppId --role "Storage Blob Data Contributor" --scope $subScope | Out-Null
# RBAC-admin so it can grant the learner role. Condition: it may ONLY assign the one learner role,
# so a compromised mgmt SP cannot hand out Owner/Contributor. ($learnerRoleId fetched once above.)
$cond = "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$learnerRoleId}))"
Invoke-Az role assignment create --assignee $mgmtAppId `
    --role "Role Based Access Control Administrator" --scope $subScope `
    --condition $cond --condition-version "2.0" | Out-Null
Write-Ok "mgmt SP scoped at subscription (dynamic-RG model)"

# --- 3b. Probe SP: read-only. Used by graders.azure.mjs for the control-plane flag reads. --------
Write-Step "Ensuring read-only probe SP '$ProbeSpName'"
$probeAppId  = Get-SpAppId $ProbeSpName
$probeSecret = $null
if ([string]::IsNullOrWhiteSpace($probeAppId)) {
    $sp = Invoke-Az ad sp create-for-rbac --name $ProbeSpName --skip-assignment -o json | ConvertFrom-Json
    $probeAppId  = $sp.appId
    $probeSecret = $sp.password
    Write-Ok "created probe SP $probeAppId"
} else {
    Write-Skip "probe SP $probeAppId"
    if ($RotateSecrets) {
        $probeSecret = (Invoke-Az ad sp credential reset --id $probeAppId --query password -o tsv)
        Write-Ok "rotated probe SP secret"
    }
}
# Reader at the SUBSCRIPTION: the grader reads control-plane flags on the dynamic session RG,
# which can be any RG in the sub. Reader canNOT list storage keys and canNOT read blob data, so a
# leaked probe secret is harmless. (The grader's unauthenticated blob GET needs no creds at all.)
Write-Step "Assigning probe SP -> Reader at subscription"
Invoke-Az role assignment create --assignee $probeAppId --role "Reader" --scope $subScope | Out-Null
Write-Ok "probe SP scoped Reader at subscription"

# ---------------------------------------------------------------------------
# 4. Deny-expensive Azure Policy  (the SCP analog) at subscription scope
# ---------------------------------------------------------------------------
Write-Step "Ensuring deny-expensive policy definition + assignment"
if (-not (Test-Path $policyFile)) { throw "policy file not found: $policyFile" }
$policyDoc  = Get-Content $policyFile -Raw | ConvertFrom-Json
$policyName = $policyDoc.name
# The 'rules' az expects is the properties.policyRule object; params is properties.parameters.
$rulesPath  = Join-Path ([System.IO.Path]::GetTempPath()) "ss-deny-rules.json"
$paramsPath = Join-Path ([System.IO.Path]::GetTempPath()) "ss-deny-params.json"
$policyDoc.properties.policyRule  | ConvertTo-Json -Depth 20 | Set-Content $rulesPath  -Encoding ascii
$policyDoc.properties.parameters  | ConvertTo-Json -Depth 20 | Set-Content $paramsPath -Encoding ascii

# create-or-update the definition (idempotent).
Invoke-Az policy definition create `
    --name $policyName `
    --display-name $policyDoc.properties.displayName `
    --description  $policyDoc.properties.description `
    --rules  "@$rulesPath" `
    --params "@$paramsPath" `
    --mode "All" `
    --subscription $SubscriptionId | Out-Null
Write-Ok "policy definition $policyName"

$assignmentName = "ss-labs-deny-expensive"
# `policy assignment show` THROWS on not-found (unlike `list`), and under
# $ErrorActionPreference=Stop that surfaces as a terminating error. Soften it just for this
# existence probe so a missing assignment (the normal first-run case) means "create it".
$eap = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
$existingAssign = (& az policy assignment show --name $assignmentName --scope $subScope --query name -o tsv 2>$null)
$ErrorActionPreference = $eap
if ([string]::IsNullOrWhiteSpace($existingAssign)) {
    # Pass assignment params via a temp FILE, not inline JSON: az's shorthand parser
    # mangles inline '{ "..": {..} }' under Windows PowerShell quoting. Mirrors how the
    # definition passes --params "@file" above (which works). ConvertTo-Json guarantees
    # valid JSON; @($Location) keeps it a JSON array even for a single region.
    $assignParamsPath = Join-Path ([System.IO.Path]::GetTempPath()) "ss-deny-assign-params.json"
    @{ allowedLocations = @{ value = @($Location) } } | ConvertTo-Json -Depth 5 | Set-Content $assignParamsPath -Encoding ascii
    Invoke-Az policy assignment create `
        --name $assignmentName `
        --display-name "ShieldSync Labs - deny expensive (sub-wide)" `
        --policy $policyName `
        --scope $subScope `
        --params "@$assignParamsPath" | Out-Null
    Remove-Item $assignParamsPath -ErrorAction SilentlyContinue
    Write-Ok "assigned policy at $subScope"
} else {
    Write-Skip "policy assignment $assignmentName"
}
Remove-Item $rulesPath, $paramsPath -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# 5. Emit engine env vars
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "DONE. Put these in the engine .env / function config:"
Write-Host ""
Write-Host "AZURE_SUBSCRIPTION_ID=$SubscriptionId"
Write-Host "AZURE_TENANT_ID=$tenantId"
Write-Host "AZURE_CLIENT_ID=$mgmtAppId"
if ($mgmtSecret) {
    Write-Host "AZURE_CLIENT_SECRET=$mgmtSecret"
} else {
    Write-Host "AZURE_CLIENT_SECRET=<unchanged - re-run with -RotateSecrets to reissue>"
}
Write-Host "AZURE_SANDBOX_LOCATION=$Location"
Write-Host "AZURE_PROBE_CLIENT_ID=$probeAppId"
if ($probeSecret) {
    Write-Host "AZURE_PROBE_CLIENT_SECRET=$probeSecret"
} else {
    Write-Host "AZURE_PROBE_CLIENT_SECRET=<unchanged - re-run with -RotateSecrets to reissue>"
}
Write-Host ""
Write-Host "SP secrets are shown ONCE. Copy them into your secret store now; do NOT commit them." -ForegroundColor Yellow
