import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Save an issued document to history: stores its input snapshot so it can be
// re-rendered byte-identically later. The bytes aren't stored — the snapshot is
// a deterministic input to the same pure view component.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let body: { docType?: string; title?: string; ref?: string; refSeries?: string; refYear?: number; snapshot?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.docType || !body.snapshot) {
    return NextResponse.json({ error: "docType and snapshot are required." }, { status: 400 });
  }
  const refSeries = body.refSeries === "hr" || body.refSeries === "int" ? body.refSeries : undefined;

  try {
    const data = await hrFetch(`/hr/employees/${encodeURIComponent(seq)}/generated`, {
      method: "POST",
      timeoutMs: 30000,
      body: { docType: body.docType, title: body.title, ref: body.ref, refSeries, refYear: body.refYear, snapshot: body.snapshot, actor },
    });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not save to history." }, { status: 502 });
  }
}
