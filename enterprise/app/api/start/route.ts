import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type StartBody = {
  inviteToken?: string;
};

// Extract ONLY a known, safe state code from an engine error body -- never the
// raw body (which can carry internal AWS detail). The candidate UI keys off
// these codes (see app/a/[token]/candidate-flow.tsx) to distinguish "busy,
// retry" from "link expired".
function safeEngineCode(body: unknown, allowed: readonly string[]): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error?: unknown }).error;
    if (typeof code === "string" && allowed.includes(code)) return code;
  }
  return null;
}

// Candidate-facing: lease an AWS account and start the timed assessment.
// Idempotent on the engine side -- while status is "leasing" (cold-start
// deploy in progress) or "active", the room re-calls this same route on a
// ~5s poll to refresh status; the engine recognizes the invite already has a
// live session and returns { reconnected: true, status, consoleUrl, ... }
// instead of leasing a second account. There is deliberately no separate
// /api/session/[id] route -- /api/start doubles as the status-refresh call.
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
      console.error("[api/start] engine error", err.status, err.body);
      const code = safeEngineCode(err.body, [
        "NO_CAPACITY",
        "LINK_EXPIRED",
        "NOT_STARTABLE",
        // Azure candidate-access provisioning (busy/retry, same UX as NO_CAPACITY).
        "AZURE_ACCESS_POOL_FULL",
        "AZURE_ACCESS_FAILED",
      ]);
      return NextResponse.json({ error: code ?? "Could not start the assessment." }, { status: err.status });
    }
    console.error("[api/start] unexpected error", err);
    return NextResponse.json({ error: "Could not start the assessment." }, { status: 502 });
  }
}
