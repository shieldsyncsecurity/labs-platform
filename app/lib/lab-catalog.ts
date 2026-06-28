// AUTO-GENERATED — do not edit by hand.
// Source: app/content/labs/<slug>/lab.json (+ labs/<slug>/template.yaml for `ready`)
// Regenerate: node scripts/build-lab-content.mjs  (from app/)
import type { Lab } from "./labs";

export const labCatalog: Lab[] = [
  {
    "slug": "iam-privilege-escalation",
    "title": "IAM privilege escalation",
    "level": "Intermediate",
    "free": false,
    "ready": true,
    "summary": "You've found leaked CI/CD credentials for a 'limited' deploy user. Discover how its policy lets it escalate to full admin, prove it by capturing a flag only an admin can read, then remediate so the path is closed.",
    "tags": [
      "IAM",
      "Privilege Escalation",
      "Least Privilege",
      "Policy Analysis"
    ],
    "estimatedActiveMinutes": 75
  },
  {
    "slug": "s3-misconfiguration-audit",
    "title": "S3 misconfiguration & data exposure",
    "level": "Beginner",
    "free": true,
    "ready": true,
    "summary": "Find and fix common S3 misconfigurations — public buckets, missing encryption, over-broad IAM — in a realistic mini-account, then verify your fixes.",
    "tags": [
      "S3",
      "IAM",
      "Encryption",
      "CloudTrail"
    ],
    "estimatedActiveMinutes": 30
  }
];
