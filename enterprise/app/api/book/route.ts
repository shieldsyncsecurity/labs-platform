import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type BookBody = {
  inviteToken?: string;
  slotKey?: string;
};

// Candidate-facing: book a specific time slot for the assessment. The engine
// is the atomic guard against overbooking (SLOT_FULL) and against booking
// outside the invite's window (LINK_EXPIRED) or wrong invite status
// (NOT_BOOKABLE) — this route just proxies those errors through as-is so the
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
      return NextResponse.json({ error: "booking failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "booking failed" }, { status: 502 });
  }
}
