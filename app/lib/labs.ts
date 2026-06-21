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
];

export function getLab(slug: string): Lab | undefined {
  return LABS.find((l) => l.slug === slug);
}

export function readyLabs(): Lab[] {
  return LABS.filter((l) => l.ready);
}
