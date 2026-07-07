// ShieldSync lab — storage-public-exposure-audit
// Azure analog of s3-misconfiguration-audit.
//
// Deploys ONE deliberately-broken Storage account so the learner can find and
// fix real public-exposure misconfigurations, then be graded on the fixes.
//
// The three planted flaws (the whole point of the lab — do NOT "fix" them here):
//   FLAW A  allowBlobPublicAccess = true       account permits anonymous blob access
//   FLAW B  supportsHttpsTrafficOnly = false    "Secure transfer required" is OFF
//   FLAW C  allowSharedKeyAccess = true         account-key access left on (should require Entra ID)
// Plus a blob container "public-data" with publicAccess 'Blob' (anonymous read),
// which is part of FLAW A at the container scope.
//
// The seed "secret" object (customer-export.csv) is NOT created here — the
// driver/harness uploads it post-deploy over the data plane. This keeps the
// template pure/free (no dataplane, no deploymentScript, no compute).
//
// Every resource is tagged ShieldSyncLab = <labSlug> for teardown targeting.

@description('Lab slug — stamped as the ShieldSyncLab tag on every resource for teardown targeting.')
param labSlug string = 'storage-public-exposure-audit'

@description('Azure region for the scenario. Standard_LRS + a few-KB blob only — near zero cost.')
param location string = 'eastus'

// Globally-unique, <=24 lowercase-alnum storage account name.
// 'sslab' (5) + uniqueString(...) (13) = 18 chars — within the 3..24 limit.
var storageAccountName = 'sslab${uniqueString(resourceGroup().id)}'
var containerName = 'public-data'
var seedBlobName = 'customer-export.csv'

var commonTags = {
  ShieldSyncLab: labSlug
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    // FLAW A — account permits anonymous/public blob access.
    allowBlobPublicAccess: true
    // FLAW B — "Secure transfer required" is OFF (allows plain HTTP).
    supportsHttpsTrafficOnly: false
    accessTier: 'Hot'
    // FLAW C — Shared Key (account-key) access left enabled. Account keys bypass RBAC,
    // so if one leaks the whole account is exposed; best practice is to disable it and
    // require Microsoft Entra ID. (Azure now forces minimumTlsVersion to 1.2 on new
    // accounts, so a weak-TLS-floor flaw is no longer provisionable — this replaces it.)
    // Also lets the driver seed the blob via key at deploy time; the learner disables
    // it as the fix.
    allowSharedKeyAccess: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource publicDataContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: containerName
  properties: {
    // Part of FLAW A — container-level anonymous read (blob-scope).
    // Requires allowBlobPublicAccess=true on the account to take effect.
    publicAccess: 'Blob'
  }
}

@description('Name of the deliberately-broken storage account.')
output storageAccountName string = storageAccount.name

@description('Name of the anonymously-readable container.')
output containerName string = containerName

@description('Primary blob service endpoint, e.g. https://<acct>.blob.core.windows.net/')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob

@description('Direct URL of the seeded secret object (uploaded post-deploy by the driver).')
output anonymousBlobUrl string = '${storageAccount.properties.primaryEndpoints.blob}${containerName}/${seedBlobName}'
