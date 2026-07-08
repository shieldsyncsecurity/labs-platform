import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type BookBody = {
  inviteToken?: string;
  slotKey?: string;
};

// Extract ONLY a known, safe state code from an engine error body -- never the
// raw body (which can carry internal AWS detail). The candidate UI keys off
// these codes (see app/a/[token]/candidate-flow.tsx) to react to a full slot
// or an expired link.
function safeEngineCode(body: unknown, allowed: readonly string[]): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const code = (body as { error?: unknown }).error;
    if (typeof code === "string" && allowed.includes(code)) return code;
  }
  return null;
}

// Candidate-facing: book a specific time slot for the assessment. The engine
// is the atomic guard against overbooking (SLOT_FULL) and against booking
// outside the invite's window (LINK_EXPIRED) or wrong invite status
// (NOT_BOOKABLE) -- this route just proxies those errors through as-is so the
// client can react (e.g. drop a full slot and ask the candidate to re-pick).
export async function POST(req: Request) {
  let body: BookBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken, slotKey } = body;
  if (!inviteToken || !slotKey) {
    return NextResponse.json({ error: "inviteToken and slotKey are required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/book", {
      method: "POST",
      body: { inviteToken, slotKey },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/book] engine error", err.status, err.body);
      const code = safeEngineCode(err.body, ["SLOT_FULL", "LINK_EXPIRED", "NOT_BOOKABLE"]);
      return NextResponse.json({ error: code ?? "Could not book that time." }, { status: err.status });
    }
    console.error("[api/book] unexpected error", err);
    return NextResponse.json({ error: "Could not book that time." }, { status: 502 });
  }
}
