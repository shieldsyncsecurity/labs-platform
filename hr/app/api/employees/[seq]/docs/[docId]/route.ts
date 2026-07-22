import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Download one KYC document. The bytes are streamed THROUGH this authenticated,
// allowlisted request (engine re-verifies SHA-256 on serve) — the object is
// never publicly reachable and no bearer URL is ever minted. Actor is recorded
// in the audit by the engine.
export async function GET(_req: Request, { params }: { params: Promise<{ seq: string; docId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq, docId } = await params;

  try {
    const data = await hrFetch<{ contentType?: string; fileName?: string; base64?: string }>(
      `/hr/employees/${encodeURIComponent(seq)}/docs/${encodeURIComponent(docId)}/content`,
      // Actor rides in a header — query strings land in API-gateway/CloudWatch logs.
      { headers: { "x-hr-actor": actor }, timeoutMs: 30000 },
    );
    const bytes = Buffer.from(data.base64 ?? "", "base64");
    const safeName = (data.fileName ?? "document").replace(/[^A-Za-z0-9._-]+/g, "_");
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": data.contentType ?? "application/octet-stream",
        // inline so images/PDFs preview; the browser can still save.
        "content-disposition": `inline; filename="${safeName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not retrieve the document." }, { status: 502 });
  }
}

// Delete a KYC document (audited). Retention/erasure is a deliberate HR action.
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string; docId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq, docId } = await params;

  try {
    await hrFetch(`/hr/employees/${encodeURIComponent(seq)}/docs/${encodeURIComponent(docId)}`, {
      method: "DELETE",
      body: { actor },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not delete the document." }, { status: 502 });
  }
}
