import { NextResponse } from "next/server";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getQuestionnaire, validateAnswers, type Answers } from "@/lib/questionnaire";
import type { PublicCandidateView } from "@/lib/candidate";

export const dynamic = "force-dynamic";

// PUBLIC (token-authenticated) submit endpoint for the candidate questionnaire.
// The token is the ONLY credential and the engine verifies it; this route never
// trusts anything else from the request. Responses are echoed back so the
// candidate can see exactly what they submitted.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let body: { answers?: Answers };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
  }
  const answers = body.answers ?? {};

  // Read the candidate first so we validate against the RIGHT questionnaire.
  let view: PublicCandidateView;
  try {
    view = (await hrFetch<{ candidate: PublicCandidateView }>(`/hr/questionnaire/${encodeURIComponent(token)}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 410) {
      return NextResponse.json({ error: "This link has expired. Please ask us for a fresh one." }, { status: 410 });
    }
    return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  }
  if (view.submittedAt) {
    return NextResponse.json({ error: "You have already submitted this form." }, { status: 409 });
  }

  const q = getQuestionnaire(view.questionnaireRole);
  const { ok, missing } = validateAnswers(q, answers);
  if (!ok) {
    return NextResponse.json({ error: `Please complete: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""}` }, { status: 400 });
  }

  try {
    const out = await hrFetch<{ candidate: PublicCandidateView }>(`/hr/questionnaire/${encodeURIComponent(token)}`, {
      method: "POST",
      body: { answers },
      timeoutMs: 30000,
    });
    return NextResponse.json({ ok: true, candidate: out.candidate });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 409) {
      return NextResponse.json({ error: "You have already submitted this form." }, { status: 409 });
    }
    return NextResponse.json({ error: "We could not save your answers. Please try again in a moment." }, { status: 502 });
  }
}
