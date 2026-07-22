# ShieldSync HR Engine - Lambda deployment (separate from the enterprise/labs
# engines for blast-radius AND PII isolation: the HR data plane has its OWN role,
# tables, and SSE-KMS bucket, and shares NO credentials with the others).
# Run from the engine/ directory:  .\deploy\deploy-hr.ps1
#
# ASCII-ONLY (Windows PowerShell 5.1 reads a no-BOM .ps1 as ANSI).
#
# Single-file bundle: hr-handler.mjs only. The nodejs22.x runtime provides
# @aws-sdk built-in, and the HR engine has no Azure/labs deps, so there is
# nothing else to pack.
#
# PREREQS (run once, in order):
#   node create-hr-tables.mjs        # 3 HR tables + id counter
#   node create-hr-kyc-infra.mjs     # CMK + SSE-KMS bucket; patches policy-hr.json
# Then set the shared secret and deploy:
#   $env:HR_ENGINE_SECRET="<value>"; .\deploy\deploy-hr.ps1

$PLATFORM_ACCOUNT = "750294427884"
$REGION           = "us-east-1"
$FUNCTION_NAME    = "ShieldSyncHrEngine"
$ROLE_NAME        = "ShieldSyncHrEngineRole"
$SCRIPT_DIR       = Split-Path -Parent $PSScriptRoot
$DEPLOY_DIR       = "$SCRIPT_DIR\deploy"
$ROLE_ARN         = "arn:aws:iam::${PLATFORM_ACCOUNT}:role/${ROLE_NAME}"

# -- Step 1: assume into platform account -------------------------------------
Write-Host "`n[1/6] Assuming into platform account $PLATFORM_ACCOUNT ..." -ForegroundColor Cyan
$credsJson = aws sts assume-role `
  --role-arn "arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole" `
  --role-session-name "hr-engine-deploy" `
  --query "Credentials" --output json
if ($LASTEXITCODE -ne 0) { Write-Error "STS assume failed"; exit 1 }
$creds = $credsJson | ConvertFrom-Json
$env:AWS_ACCESS_KEY_ID     = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN     = $creds.SessionToken
Write-Host "  OK"

# -- Step 2: IAM role (idempotent) --------------------------------------------
Write-Host "`n[2/6] Creating IAM role $ROLE_NAME ..." -ForegroundColor Cyan
if ((Get-Content "$DEPLOY_DIR\policy-hr.json" -Raw) -match "REPLACE_WITH_HR_KMS_KEY_ID") {
    Write-Error "policy-hr.json still has the KMS placeholder. Run 'node create-hr-kyc-infra.mjs' first."; exit 1
}
$out = aws iam create-role `
  --role-name $ROLE_NAME `
  --assume-role-policy-document "file://$DEPLOY_DIR\trust.json" `
  --description "ShieldSync HR Engine (internal, isolated PII)" 2>&1
if ($LASTEXITCODE -ne 0) {
    if (($out | Out-String) -match "EntityAlreadyExists") { Write-Host "  Already exists." }
    else { Write-Error ($out | Out-String); exit 1 }
} else { Write-Host "  Created." }

$out = aws iam put-role-policy `
  --role-name $ROLE_NAME `
  --policy-name "ShieldSyncHrEnginePolicy" `
  --policy-document "file://$DEPLOY_DIR\policy-hr.json" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($out | Out-String); exit 1 }
Write-Host "  Policy attached."

# -- Step 3: package (single file) --------------------------------------------
Write-Host "`n[3/6] Building deployment package ..." -ForegroundColor Cyan
$ZIP_PATH = "$DEPLOY_DIR\hr-engine.zip"
if (Test-Path $ZIP_PATH) { Remove-Item $ZIP_PATH -Force }
Compress-Archive -Path "$SCRIPT_DIR\hr-handler.mjs" -DestinationPath $ZIP_PATH
Write-Host "  $([Math]::Round((Get-Item $ZIP_PATH).Length/1KB,1)) KB"

# -- Step 4: upload + create/update Lambda ------------------------------------
Write-Host "`n[4/6] Deploying Lambda $FUNCTION_NAME ..." -ForegroundColor Cyan
$BUCKET = "shieldsync-engine-deploy-$PLATFORM_ACCOUNT"  # reuse the shared deploy bucket
$S3_KEY = "hr-engine.zip"
aws s3api head-bucket --bucket $BUCKET --region $REGION 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    aws s3api create-bucket --bucket $BUCKET --region $REGION 2>&1 | Out-Null
    aws s3api put-public-access-block --bucket $BUCKET `
      --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
    Write-Host "  Deploy bucket created."
}
$out2 = aws s3 cp $ZIP_PATH "s3://$BUCKET/$S3_KEY" --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
Write-Host "  Uploaded."

Start-Sleep -Seconds 12  # IAM propagation

aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    $out2 = aws lambda create-function `
      --function-name $FUNCTION_NAME `
      --runtime nodejs22.x `
      --role $ROLE_ARN `
      --handler hr-handler.handler `
      --code "S3Bucket=$BUCKET,S3Key=$S3_KEY" `
      --timeout 60 --memory-size 256 --architectures x86_64 `
      --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    aws lambda wait function-active --function-name $FUNCTION_NAME --region $REGION | Out-Null
    Write-Host "  Lambda created."
} else {
    $out2 = aws lambda update-function-code `
      --function-name $FUNCTION_NAME --s3-bucket $BUCKET --s3-key $S3_KEY --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION | Out-Null
    Write-Host "  Lambda updated."
}

# -- Step 5: environment (MERGE, never replace) -------------------------------
# Fails closed: an empty HR_ENGINE_SECRET makes the engine refuse every request.
Write-Host "`n[5/6] Merging Lambda environment ..." -ForegroundColor Cyan
$currentJson = aws lambda get-function-configuration --function-name $FUNCTION_NAME `
  --query "Environment.Variables" --output json --region $REGION
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to read environment"; exit 1 }
$vars = @{}
$current = $currentJson | ConvertFrom-Json
if ($null -ne $current) { $current.PSObject.Properties | ForEach-Object { $vars[$_.Name] = $_.Value } }
$s = [Environment]::GetEnvironmentVariable("HR_ENGINE_SECRET")
if (-not [string]::IsNullOrWhiteSpace($s)) { $vars["HR_ENGINE_SECRET"] = $s }
if ([string]::IsNullOrWhiteSpace($vars["HR_ENGINE_SECRET"])) {
    # Offer to mint one: 48 random bytes, base64 (~64 chars). The handler itself
    # refuses secrets under 32 chars, so a weak value can't ship silently.
    $gen = -join ((1..48) | ForEach-Object { [char](Get-Random -InputObject (65..90 + 97..122 + 48..57)) })
    Write-Host "  No HR_ENGINE_SECRET set. Generated candidate:" -ForegroundColor Yellow
    Write-Host "    $gen" -ForegroundColor Yellow
    Write-Error "Set it and re-run:  `$env:HR_ENGINE_SECRET=`"$gen`"; .\deploy\deploy-hr.ps1   (also `wrangler secret put HR_ENGINE_SECRET` with the SAME value)"
    exit 1
}
if ($vars["HR_ENGINE_SECRET"].Length -lt 32) {
    Write-Error "HR_ENGINE_SECRET is under 32 characters — the engine will refuse all requests (fail closed). Use a longer secret."
    exit 1
}
# Optional email transport (Resend). Merged only when set in this shell.
foreach ($k in @("RESEND_API_KEY", "HR_MAIL_FROM")) {
    $v = [Environment]::GetEnvironmentVariable($k)
    if (-not [string]::IsNullOrWhiteSpace($v)) { $vars[$k] = $v }
}
$envFile = Join-Path $PSScriptRoot "hr-env.tmp.json"
@{ Variables = $vars } | ConvertTo-Json -Compress | Set-Content -Path $envFile -NoNewline
try {
    aws lambda update-function-configuration --function-name $FUNCTION_NAME --environment "file://$envFile" --region $REGION | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to set environment"; exit 1 }
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION | Out-Null
    Write-Host ("  Environment merged (" + ($vars.Keys -join ", ") + ").")
} finally {
    Remove-Item -Path $envFile -Force -ErrorAction SilentlyContinue
}

# -- Step 6: API Gateway HTTP API ---------------------------------------------
Write-Host "`n[6/6] API Gateway HTTP API ..." -ForegroundColor Cyan
$API_NAME = "ShieldSyncHrEngineAPI"
$existingApi = aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingApi)) {
    $apiOut = (aws apigatewayv2 create-api --name $API_NAME --protocol-type HTTP --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "API creation failed"; exit 1 }
    $API_ID = $apiOut.ApiId
    $intOut = (aws apigatewayv2 create-integration --api-id $API_ID --integration-type AWS_PROXY `
      --integration-uri "arn:aws:lambda:${REGION}:${PLATFORM_ACCOUNT}:function:${FUNCTION_NAME}" `
      --payload-format-version "2.0" --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "Integration creation failed"; exit 1 }
    $INT_ID = $intOut.IntegrationId
    aws apigatewayv2 create-route --api-id $API_ID --route-key "ANY /{proxy+}" --target "integrations/$INT_ID" --region $REGION | Out-Null
    aws apigatewayv2 create-route --api-id $API_ID --route-key "ANY /" --target "integrations/$INT_ID" --region $REGION | Out-Null
    aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy --region $REGION | Out-Null
    aws lambda add-permission --function-name $FUNCTION_NAME --statement-id AllowAPIGateway `
      --action "lambda:InvokeFunction" --principal "apigateway.amazonaws.com" `
      --source-arn "arn:aws:execute-api:${REGION}:${PLATFORM_ACCOUNT}:${API_ID}/*/*" --region $REGION | Out-Null
    $HR_ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Created API $API_ID."
} else {
    $API_ID = $existingApi.Trim()
    $HR_ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Already exists: $API_ID"
}

# -- Post-deploy: throttle, log retention, smoke test -------------------------
Write-Host "`n[7/7] Hardening + smoke test ..." -ForegroundColor Cyan

# Modest stage throttle: the Worker is the only legitimate caller.
aws apigatewayv2 update-stage --api-id $API_ID --stage-name '$default' `
  --default-route-settings "ThrottlingRateLimit=20,ThrottlingBurstLimit=40" --region $REGION | Out-Null
Write-Host "  API throttle: rate 20/s, burst 40."

# Log retention (never-expire is a cost + data-hygiene leak).
aws logs put-retention-policy --log-group-name "/aws/lambda/$FUNCTION_NAME" --retention-in-days 365 --region $REGION 2>&1 | Out-Null
Write-Host "  Lambda log retention: 365 days."

# Smoke test: health (no token) must 200; a bad token must 401.
Start-Sleep -Seconds 3
try {
    $h = Invoke-WebRequest -Uri "$HR_ENGINE_URL/hr/health" -UseBasicParsing -TimeoutSec 20
    if ($h.StatusCode -eq 200) { Write-Host "  Smoke: /hr/health 200 OK." -ForegroundColor Green }
    else { Write-Warning "  Smoke: /hr/health returned $($h.StatusCode)" }
} catch { Write-Warning "  Smoke: /hr/health FAILED - $($_.Exception.Message)" }
try {
    Invoke-WebRequest -Uri "$HR_ENGINE_URL/hr/employees" -Headers @{ "x-engine-token" = "wrong" } -UseBasicParsing -TimeoutSec 20 | Out-Null
    Write-Warning "  Smoke: bad token was NOT rejected - investigate before go-live!"
} catch {
    Write-Host "  Smoke: bad token rejected (expected)." -ForegroundColor Green
}

Remove-Item Env:AWS_ACCESS_KEY_ID     -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SESSION_TOKEN     -ErrorAction SilentlyContinue

Write-Host "`nSUCCESS: HR engine deployment complete." -ForegroundColor Green
Write-Host "`nHR_ENGINE_URL = $HR_ENGINE_URL" -ForegroundColor Yellow
Write-Host "Next: set it as HR_ENGINE_URL in hr/wrangler.jsonc (vars), and set the secret:" -ForegroundColor Yellow
Write-Host "  cd ../hr; npx wrangler secret put HR_ENGINE_SECRET   (match the Lambda's value)" -ForegroundColor Yellow
Write-Host "  npx wrangler secret put HR_SESSION_SECRET; npx wrangler secret put COGNITO_CLIENT_SECRET" -ForegroundColor Yellow
