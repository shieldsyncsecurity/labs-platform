import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

// Candidate-facing: allocate a capture epoch for a fresh recorder session. The
// engine enforces the lifecycle gate (started + not erased/revoked) and returns
// a monotonic epoch that namespaces this session's uploads (so a reload can't
// overwrite earlier evidence).
export async function POST(req: Request) {
  let body: { inviteToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }
  try {
    const result = await entFetch("/ent/rec/start", {
      method: "POST",
      body: { inviteToken: body.inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "start failed" }, { status: err.status });
    }
    return NextResponse.json({ error: "start failed" }, { status: 502 });
  }
}
