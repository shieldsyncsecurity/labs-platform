# ShieldSync Labs — Vercel app deployment
# Run from the labs-platform\ root:  .\deploy\vercel-deploy.ps1
#
# Prerequisite: npm install -g vercel  (already installed)
# This script needs an interactive terminal (opens a browser for Vercel login).

$APP_DIR    = Join-Path $PSScriptRoot "..\app"
$ENGINE_URL = "https://lewssnjjhi.execute-api.us-east-1.amazonaws.com"

Set-Location $APP_DIR
Write-Host "Working directory: $(Get-Location)" -ForegroundColor DarkGray

# ── 1. Login ──────────────────────────────────────────────────────────────────
Write-Host "`n[1/4] Vercel login ..." -ForegroundColor Cyan
vercel login
if ($LASTEXITCODE -ne 0) { Write-Error "Login failed"; exit 1 }

# ── 2. Initial deploy (gets the project URL) ──────────────────────────────────
Write-Host "`n[2/4] Initial deploy to get project URL ..." -ForegroundColor Cyan
$firstDeploy = vercel deploy --yes 2>&1
Write-Host $firstDeploy
$PREVIEW_URL = ($firstDeploy -match "https://" | Where-Object { $_ -match "vercel.app" }) | Select-Object -Last 1
Write-Host "  Preview URL: $PREVIEW_URL"

# Infer project name from .vercel/project.json
$projectJson = Get-Content ".vercel\project.json" -Raw 2>$null | ConvertFrom-Json
$PROJECT_NAME = $projectJson.projectId

# ── 3. Set environment variables ──────────────────────────────────────────────
Write-Host "`n[3/4] Setting environment variables ..." -ForegroundColor Cyan

# Read .env.local for Cognito values
$envFile = Get-Content ".env.local" | Where-Object { $_ -match "^[A-Z_]" }
$env = @{}
foreach ($line in $envFile) {
    $parts = $line.TrimEnd() -split "=", 2
    if ($parts.Count -eq 2) { $env[$parts[0]] = $parts[1] }
}

# Helper: set env var (remove existing silently, then add)
function Add-VEnv($name, $value) {
    Write-Host "  $name"
    vercel env rm $name production --yes 2>$null
    $value | vercel env add $name production
}

Add-VEnv "ENGINE_URL"            $ENGINE_URL
Add-VEnv "NEXT_PUBLIC_AUTH_MODE" "cognito"
Add-VEnv "COGNITO_REGION"        $env["COGNITO_REGION"]
Add-VEnv "COGNITO_DOMAIN"        $env["COGNITO_DOMAIN"]
Add-VEnv "COGNITO_USER_POOL_ID"  $env["COGNITO_USER_POOL_ID"]
Add-VEnv "COGNITO_CLIENT_ID"     $env["COGNITO_CLIENT_ID"]
Add-VEnv "COGNITO_CLIENT_SECRET" $env["COGNITO_CLIENT_SECRET"]
Add-VEnv "SESSION_SECRET"        $env["SESSION_SECRET"]
# APP_URL will be set after production deploy

# ── 4. Promote to production ──────────────────────────────────────────────────
Write-Host "`n[4/4] Production deploy ..." -ForegroundColor Cyan
$prodDeploy = vercel deploy --prod --yes 2>&1
Write-Host $prodDeploy

# Parse the production URL
$APP_URL = ($prodDeploy | Where-Object { $_ -match "https://.*\.vercel\.app" } |
    ForEach-Object { [regex]::Match($_, "https://[^\s]+").Value } |
    Select-Object -Last 1)

if ($APP_URL) {
    Write-Host "`n  Production URL: $APP_URL" -ForegroundColor Green
    $APP_URL | vercel env add APP_URL production
    # Redeploy to pick up APP_URL
    Write-Host "  Re-deploying to pick up APP_URL..."
    vercel deploy --prod --yes 2>&1 | Select-Object -Last 3
}

# ── Manual Cognito step ───────────────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════════════╗
║  REQUIRED: Update Cognito Hosted UI redirect URLs   ║
╚══════════════════════════════════════════════════════╝

AWS Console → Cognito → us-east-1_5Hu20LAi8
  → App clients → 36s7i98jnt0mj8n5m8h0s711kn
  → Edit hosted UI

Add to Allowed callback URLs:
  $APP_URL/api/auth/callback

Add to Allowed sign-out URLs:
  $APP_URL

Save changes — auth will work immediately (no redeploy needed).

ENGINE_URL : $ENGINE_URL
APP_URL    : $APP_URL
"@ -ForegroundColor Yellow