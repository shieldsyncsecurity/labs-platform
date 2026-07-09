# Runs in Windows PowerShell 5.1+ or PowerShell 7 (no v7-only syntax; ASCII-only).
<#
    ShieldSync Labs - Azure Entra SEAT-USER POOL setup  (ONE-TIME, per LABS TENANT)
    ==============================================================================
    Companion to setup-landing-zone.ps1. That script builds the RG pool + service
    principals + learner role + deny-policy. THIS script builds the missing piece
    for PORTAL (GUI) access: a pool of real Microsoft Entra USERS that a candidate
    signs into portal.azure.com AS, scoped (by the engine, per-lease) to their one
    resource group.

    WHY a pool of users (not one per candidate on the fly): creating/deleting a
    directory user on every assessment is slow + leaves tombstones. Instead we
    pre-create N reusable "learner" users; the engine claims a free one on /start,
    resets its password to a one-time value it shows the candidate, RBAC-scopes it
    to the leased RG (azure-infra.mintAccess), and on teardown strips the RBAC +
    resets the password again -> back in the pool.

    WHY a DEDICATED labs tenant (NOT your corp directory): these users are
    low-trust and Security Defaults / MFA must be OFF for them (a candidate in a
    timed assessment cannot do MFA enrollment). You must never relax those on a
    corporate tenant. Run this ONLY against a tenant created solely for labs.

    The engine's management SP (shieldsync-lab-mgmt) is granted the built-in
    "User Administrator" Entra role so it can reset pool-user passwords per-lease.
    In a dedicated labs tenant that holds nothing but lab users, this is safe.

    IDEMPOTENT: safe to re-run. Existing users are left as-is; a larger -PoolSize
    only ADDS missing users. It never deletes users.

    THIS SCRIPT DOES NOT RUN IN THE BUILD ENVIRONMENT. You run it against the real
    labs tenant.

    PREREQS:
      - The dedicated labs Entra tenant exists, and a subscription is associated
        with it (its RG pool provisioned via setup-landing-zone.ps1 first).
      - az CLI >= 2.60 logged IN TO THE LABS TENANT:
            az login --tenant <LABS_TENANT_ID> --allow-no-subscriptions
        (or `az login` then `az account set --subscription <LABS_SUB_ID>`)
      - You are a Global Administrator (or Privileged Role + User Administrator)
        of the labs tenant.

    USAGE:
      pwsh ./setup-seat-pool.ps1 -SubscriptionId <LABS_SUB_ID> -PoolSize 10
      pwsh ./setup-seat-pool.ps1 -SubscriptionId <LABS_SUB_ID> -PoolSize 25   # grow the pool
#>

[CmdletBinding()]
param(
    # A subscription in the LABS tenant (used only to resolve tenant context).
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,

    # How many concurrent Portal candidates you can host = pool size. Grow later
    # by re-running with a bigger number.
    [int]$PoolSize = 10,

    # UPN prefix -> learner001@<initial-domain>, learner002, ...
    [string]$UserPrefix = "learner",

    # Display-name prefix shown in the Portal.
    [string]$DisplayPrefix = "ShieldSync Candidate",

    # The management SP (from setup-landing-zone.ps1) that the engine authenticates
    # as; it needs User Administrator to reset pool-user passwords per-lease.
    [string]$MgmtSpName = "shieldsync-lab-mgmt"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    ok: $msg" -ForegroundColor Green }
function Write-Skip([string]$msg) { Write-Host "    skip (exists): $msg" -ForegroundColor DarkGray }
function Write-Warn2([string]$msg){ Write-Host "    WARN: $msg" -ForegroundColor Yellow }

# az emits JSON on stdout; wrap so a native failure becomes a terminating error.
# ($args is passed verbatim so single-dash az flags are not mis-bound - same
#  reasoning as setup-landing-zone.ps1's Invoke-Az.)
function Invoke-Az {
    $out = & az @args
    if ($LASTEXITCODE -ne 0) { throw "az $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $out
}

# Entra-compliant throwaway password (>= 8 chars, 3 of 4 categories). The ENGINE
# overwrites this per-lease; it only has to satisfy the create call.
function New-ThrowawayPassword {
    $u = -join ((65..90)  | Get-Random -Count 5 | ForEach-Object { [char]$_ })
    $l = -join ((97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ })
    $d = -join ((48..57)  | Get-Random -Count 4 | ForEach-Object { [char]$_ })
    $s = -join (('!@#$%^&*'.ToCharArray()) | Get-Random -Count 2)
    return "Ss1!" + $u + $l + $d + $s
}

# ---------------------------------------------------------------------------
# 0. Context + tenant
# ---------------------------------------------------------------------------
Write-Step "Selecting subscription $SubscriptionId"
Invoke-Az account set --subscription $SubscriptionId | Out-Null
$acct     = Invoke-Az account show -o json | ConvertFrom-Json
$tenantId = $acct.tenantId
Write-Ok "labs tenant $tenantId"

# The verified initial domain (<name>.onmicrosoft.com) the pool users live under.
Write-Step "Resolving the tenant's initial domain"
$domains = Invoke-Az rest --method GET --url 'https://graph.microsoft.com/v1.0/domains' -o json | ConvertFrom-Json
$initial = ($domains.value | Where-Object { $_.isInitial }) | Select-Object -First 1
if (-not $initial) { throw "could not resolve an initial onmicrosoft.com domain for tenant $tenantId" }
$domain = $initial.id
Write-Ok "domain $domain"

# ---------------------------------------------------------------------------
# 1. Seat-user pool  (idempotent: create only the missing ones)
# ---------------------------------------------------------------------------
Write-Step "Ensuring $PoolSize pooled learner users ($UserPrefix###@$domain)"
$created = 0
for ($i = 1; $i -le $PoolSize; $i++) {
    $upn = "{0}{1:D3}@{2}" -f $UserPrefix, $i, $domain
    # `az ad user show` throws on not-found; soften for the existence probe.
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
    $exists = (& az ad user show --id $upn --query id -o tsv 2>$null)
    $ErrorActionPreference = $eap
    if (-not [string]::IsNullOrWhiteSpace($exists)) { Write-Skip $upn; continue }

    $pw   = New-ThrowawayPassword
    $disp = "{0} {1:D3}" -f $DisplayPrefix, $i
    # force-change-password OFF: the engine sets a one-time password per-lease and
    # the candidate must be able to sign straight in (no change-password wall
    # mid-assessment).
    Invoke-Az ad user create `
        --display-name $disp `
        --user-principal-name $upn `
        --password $pw `
        --force-change-password-next-sign-in false | Out-Null
    $created++
    Write-Ok $upn
}
Write-Ok "$created new user(s); pool size now >= $PoolSize"

# ---------------------------------------------------------------------------
# 2. Grant the mgmt SP "User Administrator" (reset pool passwords per-lease)
# ---------------------------------------------------------------------------
# Directory ROLES are Graph objects, NOT ARM RBAC. Activate the role from its
# well-known template if it isn't active yet, then add the mgmt SP as a member.
$USER_ADMIN_TEMPLATE = "fe930be7-5e62-47db-91af-98c3a49a38b1"  # built-in "User Administrator"

Write-Step "Ensuring mgmt SP '$MgmtSpName' has User Administrator"
$mgmtAppId = (& az ad sp list --display-name $MgmtSpName --query "[0].appId" -o tsv 2>$null)
if ([string]::IsNullOrWhiteSpace($mgmtAppId)) {
    throw "mgmt SP '$MgmtSpName' not found - run setup-landing-zone.ps1 against this tenant first."
}
$mgmtObjId = (Invoke-Az ad sp show --id $mgmtAppId --query id -o tsv)
Write-Ok "mgmt SP object id $mgmtObjId"

# Find the ACTIVATED directoryRole for the template (may not exist until activated).
$roles = Invoke-Az rest --method GET --url 'https://graph.microsoft.com/v1.0/directoryRoles' -o json | ConvertFrom-Json
$role  = ($roles.value | Where-Object { $_.roleTemplateId -eq $USER_ADMIN_TEMPLATE }) | Select-Object -First 1
if (-not $role) {
    Write-Step "Activating User Administrator role from template"
    $body = (@{ roleTemplateId = $USER_ADMIN_TEMPLATE } | ConvertTo-Json -Compress)
    $role = Invoke-Az rest --method POST --url 'https://graph.microsoft.com/v1.0/directoryRoles' `
        --headers 'Content-Type=application/json' --body $body -o json | ConvertFrom-Json
    Write-Ok "activated (role id $($role.id))"
}
$roleId = $role.id

# Is the mgmt SP already a member? (idempotent)
$members = Invoke-Az rest --method GET `
    --url "https://graph.microsoft.com/v1.0/directoryRoles/$roleId/members?`$select=id" -o json | ConvertFrom-Json
$already = ($members.value | Where-Object { $_.id -eq $mgmtObjId }) | Select-Object -First 1
if ($already) {
    Write-Skip "mgmt SP already User Administrator"
} else {
    $refBody = (@{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$mgmtObjId" } | ConvertTo-Json -Compress)
    Invoke-Az rest --method POST `
        --url "https://graph.microsoft.com/v1.0/directoryRoles/$roleId/members/`$ref" `
        --headers 'Content-Type=application/json' --body $refBody | Out-Null
    Write-Ok "granted mgmt SP User Administrator"
}

# ---------------------------------------------------------------------------
# 3. Output + manual gotchas
# ---------------------------------------------------------------------------
Write-Host ""
Write-Step "DONE. Add to the ENTERPRISE engine (Lambda) env, alongside the SP creds from setup-landing-zone.ps1:"
Write-Host ""
Write-Host "AZURE_SEATPOOL_DOMAIN=$domain"
Write-Host "AZURE_SEATPOOL_PREFIX=$UserPrefix"
Write-Host "AZURE_SEATPOOL_SIZE=$PoolSize"
Write-Host ""
Write-Warn2 "MANUAL, ONE-TIME on this labs tenant (a candidate cannot do MFA in a timed test):"
Write-Warn2 "  Entra ID -> Overview -> Properties -> Manage Security defaults -> DISABLED."
Write-Warn2 "  (If you later add Conditional Access, EXCLUDE the $UserPrefix### users.)"
Write-Host ""
Write-Warn2 "These users are sign-in identities. Keep this tenant labs-ONLY; never add corp resources to it."
