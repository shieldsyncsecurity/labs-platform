# ShieldSync Engine — Lambda deployment script
# Run from the engine/ directory: .\deploy\deploy.ps1

$PLATFORM_ACCOUNT = "750294427884"
$REGION           = "us-east-1"
$FUNCTION_NAME    = "ShieldSyncEngine"
$ROLE_NAME        = "ShieldSyncEngineRole"
$SCRIPT_DIR       = Split-Path -Parent $PSScriptRoot
$DEPLOY_DIR       = "$SCRIPT_DIR\deploy"
$ROLE_ARN         = "arn:aws:iam::${PLATFORM_ACCOUNT}:role/${ROLE_NAME}"

# ── Step 1: assume into platform account ─────────────────────────────────────
Write-Host "`n[1/5] Assuming into platform account $PLATFORM_ACCOUNT ..." -ForegroundColor Cyan
$credsJson = aws sts assume-role `
  --role-arn "arn:aws:iam::${PLATFORM_ACCOUNT}:role/OrganizationAccountAccessRole" `
  --role-session-name "engine-deploy" `
  --query "Credentials" `
  --output json
if ($LASTEXITCODE -ne 0) { Write-Error "STS assume failed"; exit 1 }
$creds = $credsJson | ConvertFrom-Json
$env:AWS_ACCESS_KEY_ID     = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN     = $creds.SessionToken
Write-Host "  OK"

# ── Step 2: create IAM role (idempotent) ─────────────────────────────────────
Write-Host "`n[2/5] Creating IAM role $ROLE_NAME ..." -ForegroundColor Cyan
$out = aws iam create-role `
  --role-name $ROLE_NAME `
  --assume-role-policy-document "file://$DEPLOY_DIR\trust.json" `
  --description "ShieldSync Labs Engine" 2>&1
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
  --policy-name "ShieldSyncEnginePolicy" `
  --policy-document "file://$DEPLOY_DIR\policy.json" 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error ($out | Out-String); exit 1 }
Write-Host "  Policy attached."

# ── Step 3: build deployment package ─────────────────────────────────────────
Write-Host "`n[3/5] Building deployment package ..." -ForegroundColor Cyan
$ZIP_PATH  = "$DEPLOY_DIR\engine.zip"
# aws-nuke binary lives in S3 and is fetched by Lambda at init — NOT bundled here.
if (Test-Path $ZIP_PATH) { Remove-Item $ZIP_PATH -Force }

Compress-Archive -Path "$SCRIPT_DIR\handler.mjs","$SCRIPT_DIR\labinfra.mjs","$SCRIPT_DIR\graders.mjs" -DestinationPath $ZIP_PATH

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($ZIP_PATH, "Update")

# Entry path MUST be labs/<slug>/<file> so it unzips to /var/task/labs/... where
# labinfra.mjs reads it (join(__dirname,"labs",slug,"template.yaml")). Compute the
# relative path from the RESOLVED labs root and prepend "labs/" — the old
# Substring(("$SCRIPT_DIR\..\").Length) math ate 10 chars because Get-ChildItem
# resolves the `..`, producing mangled entries like "sconfiguration-audit/template.yaml"
# → ENOENT in the Lambda.
$LABS_ROOT = (Resolve-Path "$SCRIPT_DIR\..\labs").Path
Get-ChildItem $LABS_ROOT -Recurse -File | ForEach-Object {
    $rel = "labs/" + $_.FullName.Substring($LABS_ROOT.Length + 1).Replace("\","/")
    $e = $zip.CreateEntry($rel); $s = $e.Open()
    $b = [System.IO.File]::ReadAllBytes($_.FullName); $s.Write($b,0,$b.Length); $s.Close()
}
$zip.Dispose()
Write-Host "  $([Math]::Round((Get-Item $ZIP_PATH).Length/1MB,1)) MB"

# ── Step 4: upload to S3, then create/update Lambda ─────────────────────────
# Direct upload limit is 50 MB; our binary pushes us over — use S3.
Write-Host "`n[4/5] Uploading to S3 and deploying Lambda $FUNCTION_NAME ..." -ForegroundColor Cyan

$BUCKET = "shieldsync-engine-deploy-$PLATFORM_ACCOUNT"
$S3_KEY = "engine.zip"

# Create bucket if it doesn't exist
$bucketOut = aws s3api head-bucket --bucket $BUCKET --region $REGION 2>&1
if ($LASTEXITCODE -ne 0) {
    $out2 = aws s3api create-bucket --bucket $BUCKET --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    # Block public access on the deploy bucket
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
      --handler handler.handler `
      --code "S3Bucket=$BUCKET,S3Key=$S3_KEY" `
      --timeout 900 `
      --memory-size 512 `
      --architectures x86_64 `
      --region $REGION 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Error ($out2 | Out-String); exit 1 }
    Write-Host "  Lambda created."
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

# ── Step 5: API Gateway HTTP API ─────────────────────────────────────────────
# Lambda Function URLs with Principal:* are blocked by Lambda Block Public Access
# (enabled by default on new accounts since Sep 2024). API Gateway sidesteps this.
Write-Host "`n[5/5] API Gateway HTTP API ..." -ForegroundColor Cyan
$API_NAME = "ShieldSyncEngineAPI"

$existingApi = aws apigatewayv2 get-apis --region $REGION --query "Items[?Name=='$API_NAME'].ApiId" --output text 2>&1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingApi)) {
    # Create the HTTP API
    $apiOut = (aws apigatewayv2 create-api `
      --name $API_NAME `
      --protocol-type HTTP `
      --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "API creation failed"; exit 1 }
    $API_ID = $apiOut.ApiId
    Write-Host "  API created: $API_ID"

    # Create Lambda integration (payload format 2.0 = same event shape as Function URLs)
    $intOut = (aws apigatewayv2 create-integration `
      --api-id $API_ID `
      --integration-type AWS_PROXY `
      --integration-uri "arn:aws:lambda:${REGION}:${PLATFORM_ACCOUNT}:function:${FUNCTION_NAME}" `
      --payload-format-version "2.0" `
      --region $REGION) | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { Write-Error "Integration creation failed"; exit 1 }
    $INT_ID = $intOut.IntegrationId
    Write-Host "  Integration created: $INT_ID"

    # Route: ANY /{proxy+} → integration
    aws apigatewayv2 create-route `
      --api-id $API_ID `
      --route-key "ANY /{proxy+}" `
      --target "integrations/$INT_ID" `
      --region $REGION | Out-Null
    # Also catch requests to root /
    aws apigatewayv2 create-route `
      --api-id $API_ID `
      --route-key "ANY /" `
      --target "integrations/$INT_ID" `
      --region $REGION | Out-Null
    Write-Host "  Routes created."

    # Create $default stage with auto-deploy
    aws apigatewayv2 create-stage `
      --api-id $API_ID `
      --stage-name '$default' `
      --auto-deploy `
      --region $REGION | Out-Null
    Write-Host "  Stage created."

    # Allow API Gateway to invoke the Lambda
    aws lambda add-permission `
      --function-name $FUNCTION_NAME `
      --statement-id AllowAPIGateway `
      --action "lambda:InvokeFunction" `
      --principal "apigateway.amazonaws.com" `
      --source-arn "arn:aws:execute-api:${REGION}:${PLATFORM_ACCOUNT}:${API_ID}/*/*" `
      --region $REGION | Out-Null
    Write-Host "  Lambda permission granted."

    $ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Created."
} else {
    $API_ID = $existingApi.Trim()
    $ENGINE_URL = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"
    Write-Host "  Already exists: $API_ID"
}

Remove-Item Env:AWS_ACCESS_KEY_ID   -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SESSION_TOKEN   -ErrorAction SilentlyContinue

Write-Host "`n✅  Deployment complete!" -ForegroundColor Green
Write-Host "`nENGINE_URL = $ENGINE_URL" -ForegroundColor Yellow
Write-Host "`nNext: add ENGINE_URL to Vercel + update app\.env.local"
