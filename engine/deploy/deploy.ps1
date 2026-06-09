# ShieldSync Engine — Lambda deployment script
# Run from the engine/ directory: .\deploy\deploy.ps1
#
# Prerequisites:
#   - AWS CLI configured with management account (851236938541) credentials
#   - Linux aws-nuke binary downloaded to engine/bin/aws-nuke-linux (chmod +x)

$ErrorActionPreference = "Stop"

$PLATFORM_ACCOUNT = "750294427884"
$MGMT_ACCOUNT     = "851236938541"
$REGION           = "us-east-1"
$FUNCTION_NAME    = "ShieldSyncEngine"
$ROLE_NAME        = "ShieldSyncEngineRole"
$SCRIPT_DIR       = Split-Path -Parent $PSScriptRoot
$DEPLOY_DIR       = "$SCRIPT_DIR\deploy"

# ── Step 1: assume into platform account ─────────────────────────────────────
Write-Host "`n[1/5] Assuming into platform account $PLATFORM_ACCOUNT ..." -ForegroundColor Cyan
$creds = aws sts assume-role `
  --role-arn "arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole" `
  --role-session-name "engine-deploy" `
  --query "Credentials" `
  --output json | ConvertFrom-Json

$env:AWS_ACCESS_KEY_ID     = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN     = $creds.SessionToken

# ── Step 2: create IAM role (idempotent) ─────────────────────────────────────
Write-Host "`n[2/5] Creating IAM role $ROLE_NAME ..." -ForegroundColor Cyan
$roleExists = aws iam get-role --role-name $ROLE_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    aws iam create-role `
      --role-name $ROLE_NAME `
      --assume-role-policy-document "file://$DEPLOY_DIR\trust.json" `
      --description "ShieldSync Labs Engine — Lambda execution role"
    Write-Host "  Role created."
} else {
    Write-Host "  Role already exists — skipping create."
}

# Attach/update inline policy
aws iam put-role-policy `
  --role-name $ROLE_NAME `
  --policy-name "ShieldSyncEnginePolicy" `
  --policy-document "file://$DEPLOY_DIR\policy.json"
Write-Host "  Policy attached."

$ROLE_ARN = "arn:aws:iam::${PLATFORM_ACCOUNT}:role/${ROLE_NAME}"

# ── Step 3: build the deployment package ─────────────────────────────────────
Write-Host "`n[3/5] Building deployment package ..." -ForegroundColor Cyan
$ZIP_PATH = "$DEPLOY_DIR\engine.zip"

# Check linux binary exists
$LINUX_BIN = "$SCRIPT_DIR\bin\aws-nuke-linux"
if (-not (Test-Path $LINUX_BIN)) {
    Write-Host "  ERROR: $LINUX_BIN not found." -ForegroundColor Red
    Write-Host "  Download it with:" -ForegroundColor Yellow
    Write-Host "  Invoke-WebRequest -Uri 'https://github.com/ekristen/aws-nuke/releases/download/v3.65.0/aws-nuke-v3.65.0-linux-amd64.tar.gz' -OutFile '$SCRIPT_DIR\bin\aws-nuke-linux.tar.gz'" -ForegroundColor Yellow
    Write-Host "  Then extract aws-nuke from the archive and rename it to aws-nuke-linux"
    exit 1
}

# Remove old zip
if (Test-Path $ZIP_PATH) { Remove-Item $ZIP_PATH }

# Create zip with required files
Compress-Archive -Path @(
    "$SCRIPT_DIR\handler.mjs",
    "$SCRIPT_DIR\labinfra.mjs"
) -DestinationPath $ZIP_PATH

# Add labs/ and bin/ directories
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($ZIP_PATH, "Update")

# Add bin/aws-nuke-linux
$entry = $zip.CreateEntry("bin/aws-nuke-linux")
$stream = $entry.Open()
$bytes = [System.IO.File]::ReadAllBytes($LINUX_BIN)
$stream.Write($bytes, 0, $bytes.Length)
$stream.Close()

# Add labs/ content (template.yaml files)
Get-ChildItem "$SCRIPT_DIR\..\labs" -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring("$SCRIPT_DIR\..\".Length).Replace("\", "/")
    $e = $zip.CreateEntry($rel)
    $s = $e.Open()
    $b = [System.IO.File]::ReadAllBytes($_.FullName)
    $s.Write($b, 0, $b.Length)
    $s.Close()
}

$zip.Dispose()
$zipSize = (Get-Item $ZIP_PATH).Length / 1MB
Write-Host "  Package built: $([Math]::Round($zipSize, 1)) MB"

# ── Step 4: create or update the Lambda function ─────────────────────────────
Write-Host "`n[4/5] Deploying Lambda function $FUNCTION_NAME ..." -ForegroundColor Cyan
# Allow role propagation
Start-Sleep -Seconds 10

$fnExists = aws lambda get-function --function-name $FUNCTION_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    aws lambda create-function `
      --function-name $FUNCTION_NAME `
      --runtime nodejs22.x `
      --role $ROLE_ARN `
      --handler handler.handler `
      --zip-file "fileb://$ZIP_PATH" `
      --timeout 900 `
      --memory-size 512 `
      --architectures x86_64 `
      --region $REGION
    Write-Host "  Function created."
} else {
    aws lambda update-function-code `
      --function-name $FUNCTION_NAME `
      --zip-file "fileb://$ZIP_PATH" `
      --region $REGION | Out-Null
    Write-Host "  Function code updated."
    # Wait for update to finish
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION
}

# ── Step 5: create Function URL (idempotent) ─────────────────────────────────
Write-Host "`n[5/5] Setting up Function URL ..." -ForegroundColor Cyan
$urlConfig = aws lambda get-function-url-config --function-name $FUNCTION_NAME --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) {
    $urlResult = aws lambda create-function-url-config `
      --function-name $FUNCTION_NAME `
      --auth-type NONE `
      --region $REGION | ConvertFrom-Json
    $ENGINE_URL = $urlResult.FunctionUrl.TrimEnd("/")

    # Allow public invocation (required for auth type NONE)
    aws lambda add-permission `
      --function-name $FUNCTION_NAME `
      --statement-id AllowPublicAccess `
      --action lambda:InvokeFunctionUrl `
      --principal "*" `
      --function-url-auth-type NONE `
      --region $REGION | Out-Null

    Write-Host "  Function URL created."
} else {
    $ENGINE_URL = ($urlConfig | ConvertFrom-Json).FunctionUrl.TrimEnd("/")
    Write-Host "  Function URL already exists."
}

Write-Host "`n✅ Deployment complete!" -ForegroundColor Green
Write-Host "`nENGINE_URL = $ENGINE_URL" -ForegroundColor Yellow
Write-Host "`nSet this in your Cloudflare Pages environment variables."
Write-Host "Also set it in labs-platform/app/.env.local for local testing:"
Write-Host "  ENGINE_URL=$ENGINE_URL"

# Restore local AWS credentials
Remove-Item Env:AWS_ACCESS_KEY_ID
Remove-Item Env:AWS_SECRET_ACCESS_KEY
Remove-Item Env:AWS_SESSION_TOKEN
