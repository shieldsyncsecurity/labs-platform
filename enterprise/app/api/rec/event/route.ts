import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

// Candidate-facing, best-effort: append a recording status event (start/stop/
// gap/resume/denied/degraded/upload_failed) to the invite's coverage trail.
// Also receives sendBeacon payloads (same JSON body, keepalive semantics).
export async function POST(req: Request) {
  let body: { inviteToken?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { inviteToken, type } = body;
  if (!inviteToken || !type) {
    return NextResponse.json({ error: "inviteToken and type are required" }, { status: 400 });
  }
  try {
    const result = await entFetch("/ent/rec/event", {
      method: "POST",
      body: { inviteToken, type },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "event failed" }, { status: err.status });
    }
    return NextResponse.json({ error: "event failed" }, { status: 502 });
  }
}
