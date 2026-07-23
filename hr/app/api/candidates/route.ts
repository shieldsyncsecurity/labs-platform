import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import { normalizeCandidate, type Candidate, type CandidateInput } from "@/lib/candidate";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const { candidates } = await hrFetch<{ candidates: Candidate[] }>("/hr/candidates");
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let input: CandidateInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const candidate = normalizeCandidate({ ...input, createdBy: actor });
  if (!candidate.name || !candidate.roleAppliedFor) {
    return NextResponse.json({ error: "Name and role applied for are required." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)) {
    return NextResponse.json({ error: "A valid email address is required — the questionnaire link is sent there." }, { status: 400 });
  }

  try {
    const out = await hrFetch<{ candidate: Candidate }>("/hr/candidates", { method: "POST", body: { candidate, actor } });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "Could not save the candidate." }, { status: 502 });
  }
}
