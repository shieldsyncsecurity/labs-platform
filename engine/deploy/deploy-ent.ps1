# ShieldSync ENTERPRISE Engine - Lambda deployment script (separate from the B2C
# ShieldSyncEngine for blast-radius isolation - a bad ent ship can't 500 the labs
# engine). Run from the engine/ directory: .\deploy\deploy-ent.ps1
#
# ASCII-ONLY on purpose: Windows PowerShell 5.1 reads a no-BOM .ps1 as ANSI, which
# mangles any non-ASCII chars and breaks parsing. Keep this file ASCII.
#
# Bundles ent-handler.mjs (entry) + entinfra.mjs + the REUSED labinfra.mjs / graders.mjs
# / metrics.mjs + the labs/ CloudFormation templates (leaseEnt/deployLab/teardown read
# them). Same S3-upload + API-Gateway pattern as deploy.ps1.
#
# Before FIRST run, the 6 ent tables must exist: node create-ent-tables.mjs
# To set the shared secret in one shot:  $env:ENT_ENGINE_SECRET="<value>"; .\deploy\deploy-ent.ps1

$PLATFORM_ACCOUNT = "750294427884"
$REGION           = "us-east-1"
$FUNCTION_NAME    = "ShieldSyncEnterpriseEngine"
$ROLE_NAME        = "ShieldSyncEnterpriseEngineRole"
$SCRIPT_DIR       = Split-Path -Parent $PSScriptRoot
$DEPLOY_DIR       = "$SCRIPT_DIR\deploy"
$ROLE_ARN         = "arn:aws:iam::${PLATFORM_ACCOUNT}:role/${ROLE_NAME}"

# -- Step 1: assume into platform account -------------------------------------
Write-Host "`n[1/6] Assuming into platform account $PLATFORM_ACCOUNT ..." -ForegroundColor Cyan
$credsJson = aws sts assume-role `
  --role-arn "arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole" `
  --role-session-name "ent-engine-deploy" `
  --query "Credentials" `
  --output json
if ($LASTEXITCODE -ne 0) { Write-Error "STS assume failed"; exit 1 }
$creds = $credsJson | ConvertFrom-Json
$env:AWS_ACCESS_KEY_ID     = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN     = $creds.SessionToken
Write-Host "  OK"

# -- Step 2: create IAM role (idempotent) -------------------------------------
Write-Host "`n[2/6] Creating IAM role $ROLE_NAME ..." -ForegroundColor Cyan
# Reuses the shared trust.json (Lambda service assume) - same as the B2C engine role.
$out = aws iam create-role `
  --role-name $ROLE_NAME `
  --assume-role-policy-document "file://$DEPLOY_DIR\trust.json" `
  --description "ShieldSync Enterprise (B2B) Engine" 2>&1
if ($LASTEXITCODE -ne 0) {
    if (($out | Out-String) -match "EntityAlreadyExists") {
        Write-Host "  Already exists."
    } else {
        Write-Error ($out | Out-String); exit 1
    }
} else {
    Write-Host "  Created."
}

$out = aws iam put-role-policy `
  --role-name $ROLE_NAME `
  --policy-name "ShieldSyncEnterpriseEnginePolicy" `
  --policy-document "file://$DEPLOY_DIR\policy-ent.json" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($out | Out-String); exit 1 }
Write-Host "  Policy attached."

# -- Step 3: build deployment package -----------------------------------------
Write-Host "`n[3/6] Building deployment package ..." -ForegroundColor Cyan
$ZIP_PATH  = "$DEPLOY_DIR\ent-engine.zip"
if (Test-Path $ZIP_PATH) { Remove-Item $ZIP_PATH -Force }

# ent-handler is the entry; it imports entinfra + labinfra (which needs graders + metrics).
Compress-Archive -Path `
  "$SCRIPT_DIR\ent-handler.mjs", `
  "$SCRIPT_DIR\entinfra.mjs", `
  "$SCRIPT_DIR\labinfra.mjs", `
  "$SCRIPT_DIR\graders.mjs", `
  "$SCRIPT_DIR\metrics.mjs" `
  -DestinationPath $ZIP_PATH

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($ZIP_PATH, "Update")

# labs/<slug>/<file> entries so they unzip to /var/task/labs/... where labinfra reads
# them (join(__dirname,"labs",slug,"template.yaml")). Identical packing to deploy.ps1.
$LABS_ROOT = (Resolve-Path "$SCRIPT_DIR\..\labs").Path
Get-ChildItem $LABS_ROOT -Recurse -File | ForEach-Object {
    $rel = "labs/" + $_.FullName.Substring($LABS_ROOT.Length + 1).Replace("\","/")
    $e = $zip.CreateEntry($rel); $s = $e.Open()
    $b = [System.IO.File]::ReadAllBytes($_.FullName); $s.Write($b,0,$b.Length); $s.Close()
}
$zip.Dispose()
Write-Host "  $([Math]::Round((Get-Item $ZIP_PATH).Length/1MB,1)) MB"

# -- Step 4: upload to S3, then create/update Lambda --------------------------
Write-Host "`n[4/6] Uploading to S3 and deploying Lambda $FUNCTION_NAME ..." -ForegroundColor Cyan

$BUCKET = "shieldsync-engine-deploy-$PLATFORM_ACCOUNT"  # reuse the B2C deploy bucket
$S3_KEY = "ent-engine.zip"

$bucketOut = aws s3api head-bucket --bucket $BUCKET --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) {
    $out2 = aws s3api create-bucket --bucket $BUCKET --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    aws s3api put-public-access-block --bucket $BUCKET `
      --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
    Write-Host "  S3 bucket created: $BUCKET"
} else {
    Write-Host "  S3 bucket exists: $BUCKET"
}

Write-Host "  Uploading zip to s3://$BUCKET/$S3_KEY ..."
$out2 = aws s3 cp $ZIP_PATH "s3://$BUCKET/$S3_KEY" --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
Write-Host "  Uploaded."

Start-Sleep -Seconds 12  # IAM propagation for new role

$out = aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) {
    $out2 = aws lambda create-function `
      --function-name $FUNCTION_NAME `
      --runtime nodejs22.x `
      --role $ROLE_ARN `
      --handler ent-handler.handler `
      --code "S3Bucket=$BUCKET,S3Key=$S3_KEY" `
      --timeout 900 `
      --memory-size 512 `
      --architectures x86_64 `
      --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    Write-Host "  Lambda created."
    aws lambda wait function-active --function-name $FUNCTION_NAME --region $REGION | Out-Null
} else {
    $out2 = aws lambda update-function-code `
      --function-name $FUNCTION_NAME `
      --s3-bucket $BUCKET `
      --s3-key $S3_KEY `
      --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    Write-Host "  Waiting for update ..."
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION | Out-Null
    Write-Host "  Lambda updated."
}

# -- Step 5: environment (MERGE, never replace) --------------------------------
# The ent engine's HTTP auth FAILS CLOSED: an empty ENT_ENGINE_SECRET makes the
# engine refuse every non-health request. This step MERGES local env overrides
# (ENT_ENGINE_SECRET / ENT_OTP_FROM / ENT_APP_URL / GEMINI_API_KEY, when set in
# the shell) into the Lambda's CURRENT variables. It must never write a
# replacement map: the old Variables={ONLY_ONE_KEY} form silently WIPED every
# other var (would have killed OTP email via ENT_OTP_FROM). A code-only deploy
# with no local overrides is fine as long as the Lambda already holds a secret.
Write-Host "`n[5/6] Merging Lambda environment ..." -ForegroundColor Cyan
$currentJson = aws lambda get-function-configuration `
  --function-name $FUNCTION_NAME `
  --query "Environment.Variables" --output json --region $REGION
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to read current environment"; exit 1 }
$vars = @{}
$current = $currentJson | ConvertFrom-Json
if ($null -ne $current) {
    $current.PSObject.Properties | ForEach-Object { $vars[$_.Name] = $_.Value }
}
foreach ($k in @("ENT_ENGINE_SECRET", "ENT_OTP_FROM", "ENT_APP_URL", "GEMINI_API_KEY")) {
    $v = [Environment]::GetEnvironmentVariable($k)
    if (-not [string]::IsNullOrWhiteSpace($v)) { $vars[$k] = $v }
}
if ([string]::IsNullOrWhiteSpace($vars["ENT_ENGINE_SECRET"])) {
    Write-Error "ENT_ENGINE_SECRET is neither set on the Lambda nor in this shell. Refusing to deploy a fail-closed (500-on-everything) engine. Set it and re-run:  `$env:ENT_ENGINE_SECRET=`"<value>`"; .\deploy\deploy-ent.ps1"
    exit 1
}
$envFile = Join-Path $PSScriptRoot "ent-env.tmp.json"
@{ Variables = $vars } | ConvertTo-Json -Compress | Set-Content -Path $envFile -NoNewline
try {
    aws lambda update-function-configuration `
      --function-name $FUNCTION_NAME `
      --environment "file://$envFile" `
      --region $REGION | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to set environment"; exit 1 }
    aws lambda wait function-updated --function-name $FUNCTION_NAME --region $REGION | Out-Null
    Write-Host ("  Environment merged (" + ($vars.Keys -join ", ") + ").")
} finally {
    Remove-Item -Path $envFile -Force -ErrorAction SilentlyContinue
}

# -- Step 6: API Gateway HTTP API ---------------------------------------------
Write-Host "`n[6/6] API Gateway HTTP API ..." -ForegroundColor Cyan
$API_NAME = "ShieldSyncEnterpriseEngineAPI"

$existingApi = aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingApi)) {
    $apiOut = (aws apigatewayv2 create-api `
      --name $API_NAME `
      --protocol-type HTTP `
      --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "API creation failed"; exit 1 }
    $API_ID = $apiOut.ApiId
    Write-Host "  API created: $API_ID"

    $intOut = (aws apigatewayv2 create-integration `
      --api-id $API_ID `
      --integration-type AWS_PROXY `
      --integration-uri "arn:aws:lambda:${REGION}:${PLATFORM_ACCOUNT}:function:${FUNCTION_NAME}" `
      --payload-format-version "2.0" `
      --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "Integration creation failed"; exit 1 }
    $INT_ID = $intOut.IntegrationId
    Write-Host "  Integration created: $INT_ID"

    aws apigatewayv2 create-route --api-id $API_ID --route-key "ANY /{proxy+}" --target "integrations/$INT_ID" --region $REGION | Out-Null
    aws apigatewayv2 create-route --api-id $API_ID --route-key "ANY /" --target "integrations/$INT_ID" --region $REGION | Out-Null
    Write-Host "  Routes created."

    aws apigatewayv2 create-stage --api-id $API_ID --stage-name '$default' --auto-deploy --region $REGION | Out-Null
    Write-Host "  Stage created."

    aws lambda add-permission `
      --function-name $FUNCTION_NAME `
      --statement-id AllowAPIGateway `
      --action "lambda:InvokeFunction" `
      --principal "apigateway.amazonaws.com" `
      --source-arn "arn:aws:execute-api:${REGION}:${PLATFORM_ACCOUNT}:${API_ID}/*/*" `
      --region $REGION | Out-Null
    Write-Host "  Lambda permission granted."

    $ENT_ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Created."
} else {
    $API_ID = $existingApi.Trim()
    $ENT_ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Already exists: $API_ID"
}

Remove-Item Env:AWS_ACCESS_KEY_ID     -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SESSION_TOKEN     -ErrorAction SilentlyContinue

Write-Host "`nSUCCESS: Enterprise engine deployment complete." -ForegroundColor Green
Write-Host "`nENT_ENGINE_URL = $ENT_ENGINE_URL" -ForegroundColor Yellow
Write-Host "`nNext: set this as ENT_ENGINE_URL in the enterprise app (wrangler.jsonc var)," -ForegroundColor Yellow
Write-Host "and set ENT_ENGINE_SECRET as a Worker secret matching the Lambda's value:" -ForegroundColor Yellow
Write-Host "  cd ../enterprise; npx wrangler secret put ENT_ENGINE_SECRET" -ForegroundColor Yellow
