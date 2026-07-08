import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

// Candidate-facing: resolve an invite token to its (sanitized) invite record.
// The engine is responsible for sanitizing the response -- this route just
// proxies it through so the browser never talks to the engine directly.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "missing invite token" }, { status: 400 });
  }

  try {
    const invite = await entFetch("/ent/invite", { query: { inviteToken: token } });
    return NextResponse.json(invite);
  } catch (err) {
    if (err instanceof EntEngineError) {
      // Preserve the status (the client keys off 404 to show "not a valid
      // link") but never echo the engine's raw body.
      console.error("[api/invite] engine error", err.status, err.body);
      return NextResponse.json({ error: "This assessment link is not valid." }, { status: err.status });
    }
    console.error("[api/invite] unexpected error", err);
    return NextResponse.json({ error: "invite lookup failed" }, { status: 502 });
  }
}
