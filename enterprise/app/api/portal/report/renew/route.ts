import { handleReportLifecycle } from "../lifecycle";

// Employer-facing: renew a report link (clears a revoke, extends validity to
// now + 90 days -- SAME url, so a leaked link should be revoked, not renewed).
// Ownership checks + engine proxying live in ../lifecycle.ts.
export async function POST(req: Request) {
  return handleReportLifecycle(req, "renew");
}
