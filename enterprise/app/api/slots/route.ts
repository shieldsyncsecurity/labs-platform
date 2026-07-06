import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type SlotsBody = {
  inviteToken?: string;
};

// Candidate-facing: fetch reserved-capacity counters so the app can decide
// whether to render a slot picker at all. The actual time grid is generated
// client-side (see candidate-flow.tsx) — this route just reports capacity;
// /api/book is the atomic guard against overbooking a given slot.
export async function POST(req: Request) {
  let body: SlotsBody;
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
    const result = await entFetch("/ent/slots", {
      method: "POST",
      body: { inviteToken },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "slots lookup failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "slots lookup failed" }, { status: 502 });
  }
}
