// AUTO-GENERATED — do not edit by hand.
// Source: app/content/labs/<slug>/lab.json (+ labs/<slug>/template.yaml for `ready`)
// Regenerate: node scripts/build-lab-content.mjs  (from app/)
import type { Lab } from "./labs";

export const labCatalog: Lab[] = [
  {
    "slug": "bedrock-prompt-injection",
    "title": "Secure the Bedrock assistant (prompt injection & Guardrails)",
    "level": "Beginner",
    "free": true,
    "ready": true,
    "summary": "A Bedrock-backed support assistant leaks restricted internal notes to a simple prompt injection. Prove the leak, then fix it — attach a Guardrail, scope the invoke role, and turn on model-invocation logging.",
    "tags": [
      "Bedrock",
      "GenAI",
      "Guardrails",
      "Prompt Injection"
    ],
    "estimatedActiveMinutes": 35
  },
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
