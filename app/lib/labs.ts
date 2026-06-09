// The lab catalogue shown in the platform. Mirrors the marketing site's AWS
// labs; `ready` flags which have an authored CloudFormation template in
// labs-platform/labs/<slug>/. Later this can be generated from those lab.json
// files so there's a single source of truth.

export type LabLevel = "Beginner" | "Intermediate" | "Advanced";

export type Lab = {
  slug: string;
  title: string;
  level: LabLevel;
  free: boolean;
  ready: boolean; // CloudFormation template authored + lab live
  summary: string;
  tags: string[];
  estimatedActiveMinutes: number;
};

export const LABS: Lab[] = [
  {
    slug: "s3-misconfiguration-audit",
    title: "S3 misconfiguration & data exposure",
    level: "Beginner",
    free: true,
    ready: true,
    summary:
      "Find and fix public buckets, missing encryption, and over-broad IAM in a realistic mini-account, then verify your fixes.",
    tags: ["S3", "IAM", "Encryption"],
    estimatedActiveMinutes: 30,
  },
  {
    slug: "iam-privilege-escalation",
    title: "IAM privilege escalation",
    level: "Intermediate",
    free: false,
    ready: true,
    summary:
      "Leaked CI credentials can quietly escalate to full admin. Discover the path, prove it by capturing a flag, then close the hole.",
    tags: ["IAM", "Privilege Escalation", "Least Privilege"],
    estimatedActiveMinutes: 75,
  },
  {
    slug: "kms-data-protection",
    title: "KMS & data protection",
    level: "Beginner",
    free: false,
    ready: false,
    summary:
      "Encrypt the right things the right way: KMS key policies, grants, and enforcing encryption across services.",
    tags: ["KMS", "Encryption", "Key Policy"],
    estimatedActiveMinutes: 80,
  },
  {
    slug: "guardduty-security-hub-triage",
    title: "GuardDuty & Security Hub triage",
    level: "Intermediate",
    free: false,
    ready: false,
    summary:
      "Work a stream of findings: separate signal from noise, triage by severity, and decide what to action.",
    tags: ["GuardDuty", "Security Hub", "Detection"],
    estimatedActiveMinutes: 90,
  },
  {
    slug: "cloudtrail-forensics",
    title: "CloudTrail forensics",
    level: "Advanced",
    free: false,
    ready: false,
    summary:
      "Reconstruct an attacker's actions from CloudTrail: trace the access path, find what was touched, and scope the blast radius.",
    tags: ["CloudTrail", "Forensics", "IR"],
    estimatedActiveMinutes: 120,
  },
  {
    slug: "vpc-network-exposure",
    title: "VPC network exposure",
    level: "Intermediate",
    free: false,
    ready: false,
    summary:
      "Hunt down over-permissive security groups and network paths that expose workloads, and lock them down.",
    tags: ["VPC", "Security Groups", "Networking"],
    estimatedActiveMinutes: 90,
  },
];

export function getLab(slug: string): Lab | undefined {
  return LABS.find((l) => l.slug === slug);
}

export function readyLabs(): Lab[] {
  return LABS.filter((l) => l.ready);
}
