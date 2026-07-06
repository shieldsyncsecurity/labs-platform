import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type StartBody = {
  inviteToken?: string;
};

// Candidate-facing: lease an AWS account and start the timed assessment.
// Idempotent on the engine side — while status is "leasing" (cold-start
// deploy in progress) or "active", the room re-calls this same route on a
// ~5s poll to refresh status; the engine recognizes the invite already has a
// live session and returns { reconnected: true, status, consoleUrl, ... }
// instead of leasing a second account. There is deliberately no separate
// /api/session/[id] route — /api/start doubles as the status-refresh call.
export async function POST(req: Request) {
  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken } = body;
  if (!inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/start", {
      method: "POST",
      body: { inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "start failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "start failed" }, { status: 502 });
  }
}
