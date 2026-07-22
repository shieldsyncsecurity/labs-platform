import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

// Employer-facing: list a candidate's session-recording media as presigned GET
// URLs, authenticated by the candidateReportToken (the same revocable link that
// gates /r/c/[token]) — NEVER the invite token. 404s are oracle-free.
export async function POST(req: Request) {
  let body: { candidateReportToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const token = body.candidateReportToken;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "candidateReportToken is required" }, { status: 400 });
  }
  try {
    const result = await entFetch("/ent/rec/list", {
      query: { candidateReportToken: token },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "list failed" }, { status: 502 });
  }
}
