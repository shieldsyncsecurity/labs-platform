// The lab catalogue shown in the platform. SINGLE SOURCE OF TRUTH = each lab's
// app/content/labs/<slug>/lab.json — `labCatalog` (lib/lab-catalog.ts) is generated
// from those by scripts/build-lab-content.mjs (run it after editing any lab.json).
// `ready` = a CloudFormation template exists in labs-platform/labs/<slug>/.
import { labCatalog } from "./lab-catalog";

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

export const LABS: Lab[] = labCatalog;

export function getLab(slug: string): Lab | undefined {
  return LABS.find((l) => l.slug === slug);
}

export function readyLabs(): Lab[] {
  return LABS.filter((l) => l.ready);
}
