import { handleReportLifecycle } from "../lifecycle";

// Employer-facing: revoke a report link (full report or a candidate's).
// Ownership checks + engine proxying live in ../lifecycle.ts.
export async function POST(req: Request) {
  return handleReportLifecycle(req, "revoke");
}
