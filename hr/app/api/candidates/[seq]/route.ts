import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { normalizeCandidate, type Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;
  try {
    return NextResponse.json(await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`));
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let input;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const candidate = normalizeCandidate(input);
  if (!candidate.name || !candidate.roleAppliedFor) {
    return NextResponse.json({ error: "Name and role applied for are required." }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`, { method: "PUT", body: { candidate, actor } }),
    );
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not save the candidate." }, { status: 502 });
  }
}

// Real erasure — the DPDP right the candidate is told about on the form.
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;
  try {
    await hrFetch(`/hr/candidates/${encodeURIComponent(seq)}`, { method: "DELETE", body: { actor } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not delete the candidate." }, { status: 502 });
  }
}
