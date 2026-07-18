# Runs in Windows PowerShell 5.1+ or PowerShell 7 (ASCII-only; no v7-only syntax).
<#
    ShieldSync Enterprise - Azure CANDIDATE service-principal pool seeder  (ONE-TIME, owner-run)
    ============================================================================================
    Enterprise candidates authenticate to the assessment via Cognito (email OTP) and have NO
    Entra identity, so they cannot use `az login` as a user or open the Azure Portal. Instead an
    azure-track lab hands the candidate a pooled SERVICE PRINCIPAL's credentials to
    `az login --service-principal` with, scoped (per session, by the engine) to just their own
    resource group via the least-privilege learner role.

    This script pre-creates that pool of candidate SPs and writes each SP's creds into the
    DynamoDB table the engine reads (ShieldSyncEntAzureSpPool). A pool member has ZERO standing
    role assignments; the engine grants one RG-scoped assignment at session start and the RG
    delete removes it at teardown, so a pool secret is inert except during an active session.

    Pool size = max concurrent Azure candidates (each concurrent session needs a DISTINCT SP so
    one candidate can never reach another's RG). Match it to AZURE_SLOT_CAP (engine default 20);
    for the pilot a handful is plenty.

    REQUIRES (owner):
      - az CLI logged in to the ShieldSync Enterprise Labs tenant as an admin who can create app
        registrations (Application Administrator / Owner). MFA may be prompted.
      - AWS creds for the platform account (profile ent750) to write the DynamoDB pool table.
    IDEMPOTENT: skips SPs that already exist by display name (does NOT rotate their secrets).
                Use -RotateExisting to reset secrets for existing pool SPs and rewrite their rows.

    USAGE:
      pwsh ./seed-candidate-sp-pool.ps1 -PoolSize 5
      pwsh ./seed-candidate-sp-pool.ps1 -PoolSize 8 -RotateExisting
#>

[CmdletBinding()]
param(
    [int]$PoolSize = 5,
    [string]$NamePrefix = "shieldsync-cand",
    [string]$Table = "ShieldSyncEntAzureSpPool",
    [string]$AwsProfile = "ent750",
    [string]$Region = "us-east-1",
    [switch]$RotateExisting
)

$ErrorActionPreference = "Stop"
function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Skip($m) { Write-Host "    --  $m (exists)" -ForegroundColor DarkGray }

# Confirm az + the tenant.
$acct = az account show -o json 2>$null | ConvertFrom-Json
if (-not $acct) { throw "az is not logged in. Run: az login --tenant <ShieldSync Enterprise Labs tenant id>" }
$TenantId = $acct.tenantId
Write-Step "Seeding $PoolSize candidate SPs into tenant $TenantId -> DynamoDB $Table (profile $AwsProfile)"

# Reused temp file for the DynamoDB item (holds a secret briefly; scrubbed after each put, never deleted).
$itemFile = Join-Path ([System.IO.Path]::GetTempPath()) "ss-cand-sp-item.json"

for ($i = 1; $i -le $PoolSize; $i++) {
    $name = "{0}-{1:D2}" -f $NamePrefix, $i
    $appId  = (az ad sp list --display-name $name --query "[0].appId" -o tsv 2>$null)
    $secret = $null

    if ([string]::IsNullOrWhiteSpace($appId)) {
        # Create WITHOUT any role assignment (--skip-assignment): the engine grants the
        # RG-scoped learner role per session; a free pool SP must have zero standing access.
        $sp = az ad sp create-for-rbac --name $name --skip-assignment -o json | ConvertFrom-Json
        $appId  = $sp.appId
        $secret = $sp.password
        Write-Ok "created SP $name ($appId)"
    } elseif ($RotateExisting) {
        $secret = (az ad sp credential reset --id $appId --query password -o tsv)
        Write-Ok "rotated secret for existing SP $name ($appId)"
    } else {
        Write-Skip "SP $name ($appId)"
        continue  # exists and no rotate -> leave its row untouched
    }

    # The RBAC assignment targets the SP's OBJECT id (not the appId), so store both.
    $spObjectId = (az ad sp show --id $appId --query id -o tsv)

    # Write the pool row. status=free so the engine can claim it. Item carries the secret,
    # so write via a temp file (never on the command line / process args), then scrub it.
    $item = @{
        spId         = @{ S = $appId }
        clientSecret = @{ S = $secret }
        tenantId     = @{ S = $TenantId }
        spObjectId   = @{ S = $spObjectId }
        status       = @{ S = "free" }
        createdAt    = @{ S = (Get-Date).ToUniversalTime().ToString("o") }
    }
    ($item | ConvertTo-Json -Compress -Depth 5) | Set-Content -Path $itemFile -NoNewline -Encoding ascii
    aws dynamodb put-item --table-name $Table --item "file://$itemFile" --region $Region --profile $AwsProfile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "dynamodb put-item failed for $name" }
    Set-Content -Path $itemFile -Value "" -NoNewline -Encoding ascii   # scrub secret from temp (no Remove-Item)
    Write-Ok "pool row written for $name"
}

Set-Content -Path $itemFile -Value "" -NoNewline -Encoding ascii
Write-Host "`nDone. Free pool rows:" -ForegroundColor Cyan
aws dynamodb scan --table-name $Table --filter-expression "#s = :f" `
    --expression-attribute-names '{\"#s\":\"status\"}' --expression-attribute-values '{\":f\":{\"S\":\"free\"}}' `
    --select "COUNT" --region $Region --profile $AwsProfile --query "Count" --output text
Write-Host "`nNOTE: the engine also needs AZURE_LEARNER_ROLE_NAME to match the registered learner role" -ForegroundColor Yellow
Write-Host "(default 'ShieldSync Lab Learner - Storage'); it is already the setup-landing-zone.ps1 default." -ForegroundColor Yellow
