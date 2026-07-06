import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

type SubmitBody = {
  inviteToken?: string;
  reflection?: string;
};

// Candidate-facing: submit the assessment (ends the timed attempt, triggers
// grading + async account teardown on the engine). Idempotent — a double
// submit (e.g. the client's auto-submit-on-timeout racing a manual click)
// returns the already-recorded { ok:true, submitted:true } instead of
// re-grading a torn-down account. The score/result is NEVER surfaced to the
// candidate by this route or the UI that calls it.
export async function POST(req: Request) {
  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { inviteToken, reflection } = body;
  if (!inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }

  try {
    const engineResp = (await entFetch("/ent/submit", {
      method: "POST",
      body: { inviteToken, reflection: reflection ?? "" },
    })) as { ok?: boolean; submitted?: boolean };
    // Return ONLY the safe acknowledgement — the engine's idempotent re-submit
    // path includes the scored `result` object, which must NEVER reach the
    // candidate's browser (they could read it in devtools). Strip it here.
    return NextResponse.json({ ok: engineResp?.ok ?? true, submitted: engineResp?.submitted ?? true });
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json({ error: "submit failed", detail: err.body }, { status: err.status });
    }
    return NextResponse.json({ error: "submit failed" }, { status: 502 });
  }
}
