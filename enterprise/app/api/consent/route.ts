import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type ConsentBody = {
  inviteToken?: string;
  consentVersion?: string;
};

// Candidate-facing: record consent (to the assessment ToS / data-handling
// notice) for a given invite before the candidate proceeds to OTP verification.
export async function POST(req: Request) {
  let body: ConsentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken, consentVersion } = body;
  if (!inviteToken || !consentVersion) {
    return NextResponse.json({ error: "inviteToken and consentVersion are required" }, { status: 400 });
  }

  try {
    const result = await entFetch("/ent/consent", {
      method: "POST",
      body: { inviteToken, consentVersion },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      console.error("[api/consent] engine error", err.status, err.body);
      return NextResponse.json({ error: "Could not record your consent." }, { status: err.status });
    }
    console.error("[api/consent] unexpected error", err);
    return NextResponse.json({ error: "Could not record your consent." }, { status: 502 });
  }
}
