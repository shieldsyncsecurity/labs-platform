import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

// Employer-facing: the candidate's work timeline (CloudTrail process evidence).
// Authed by the same revocable candidateReportToken that gates the report page —
// the engine enforces revocation/expiry and does the lazy fetch + cache.
export async function POST(req: Request) {
  let body: { candidateReportToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.candidateReportToken) {
    return NextResponse.json({ error: "candidateReportToken is required" }, { status: 400 });
  }
  try {
    const result = await entFetch("/ent/timeline", {
      query: { candidateReportToken: body.candidateReportToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "timeline unavailable" }, { status: err.status });
    }
    return NextResponse.json({ error: "timeline unavailable" }, { status: 502 });
  }
}
