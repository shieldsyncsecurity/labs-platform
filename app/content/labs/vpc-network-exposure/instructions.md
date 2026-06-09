# VPC network exposure

**Level:** Intermediate · **Est. active time:** ~40 min · **Region:** us-east-1

---

## The scenario

A two-tier app was deployed into a VPC (`shieldsync-lab-vpc`, `10.20.0.0/16`)
with two security groups: **`web-sg`** for the public web tier and **`db-sg`**
for the database. Someone "opened a few ports to get things working" and never
closed them. The result is textbook internet exposure:

- **`web-sg`** allows **SSH (22)** and **RDP (3389)** from **`0.0.0.0/0`** —
  every brute-force bot on the internet can knock on the admin doors.
- **`db-sg`** allows **MySQL (3306)** from **`0.0.0.0/0`** — the database is
  **directly on the internet**.

> No instances are running — the security groups *are* the misconfiguration.
> Auditing and fixing group rules is exactly the work; the lab stays at $0.

## Your mission (the grader checks these)

| # | Objective | Done when |
|---|-----------|-----------|
| 1 | **Lock down the admin ports** | No lab SG allows SSH (22) or RDP (3389) from `0.0.0.0/0` (or `::/0`). The intended HTTPS (443) may stay. |
| 2 | **Isolate the database** | `db-sg` no longer allows 3306 from the internet — the only source for 3306 is **`web-sg`**. |

---

## Step by step

### 1 — Survey the exposure

Open **EC2 → Security Groups** (link in the lab panel). Look at the **inbound**
rules for `web-sg` and `db-sg`. Anything with source `0.0.0.0/0` on a port other
than 80/443 is a finding.

```bash
aws ec2 describe-security-groups \
  --filters Name=tag:ShieldSyncLab,Values=vpc-network-exposure \
  --query 'SecurityGroups[].{Name:GroupName,Id:GroupId,Ingress:IpPermissions}'
```

### 2 — Close SSH and RDP on the web tier

Remove the two bad rules from `web-sg` (keep 443):

```bash
WEB_SG=$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values=web-sg Name=tag:ShieldSyncLab,Values=vpc-network-exposure \
  --query 'SecurityGroups[0].GroupId' --output text)

aws ec2 revoke-security-group-ingress --group-id $WEB_SG \
  --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 revoke-security-group-ingress --group-id $WEB_SG \
  --protocol tcp --port 3389 --cidr 0.0.0.0/0
```

> Real-world tip: if you genuinely need SSH/RDP, scope it to a bastion's SG or a
> corporate CIDR — never `0.0.0.0/0`. Better still, use SSM Session Manager and
> open no inbound ports at all.

### 3 — Make the database private to the web tier

Drop the public 3306 rule and replace it with a **security-group reference** so
only the web tier can reach MySQL:

```bash
DB_SG=$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values=db-sg Name=tag:ShieldSyncLab,Values=vpc-network-exposure \
  --query 'SecurityGroups[0].GroupId' --output text)

aws ec2 revoke-security-group-ingress --group-id $DB_SG \
  --protocol tcp --port 3306 --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress --group-id $DB_SG \
  --protocol tcp --port 3306 --source-group $WEB_SG
```

### 4 — Verify

```bash
aws ec2 describe-security-groups --group-ids $WEB_SG $DB_SG \
  --query 'SecurityGroups[].{Name:GroupName,Ingress:IpPermissions}'
```

`web-sg` should show only 443 from `0.0.0.0/0`; `db-sg` should show 3306 sourced
from `web-sg`. Then **Check my work** in the lab panel.

---

## Hints

- Source `0.0.0.0/0` on anything but 80/443 is the first thing to hunt for.
- Removing a rule is `revoke-security-group-ingress`; adding the SG-reference
  rule is `authorize-security-group-ingress --source-group`.
- A CIDR-to-CIDR swap (e.g. your office IP) still isn't "private" — security-group
  references survive IP changes and express intent ("the web tier", not "an IP").
- Security groups are stateful and default-deny: just remove the bad allows.

## Concepts

Security-group ingress · `0.0.0.0/0` exposure · management-port hygiene (22/3389)
· security-group references for tier isolation · least-access networking.
