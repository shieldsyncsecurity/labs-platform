import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

type Proof = { fileName: string; contentType: string; sizeBytes: number; sha256: string; base64: string };

// HR-side download of a candidate's uploaded salary proof. Gated, audited, and
// streamed through the app — the encrypted store is never exposed directly.
export async function GET(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let proof: Proof;
  try {
    proof = await hrFetch<Proof>(`/hr/candidates/${encodeURIComponent(seq)}/proof`, { query: { actor }, timeoutMs: 30000 });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "No document on file for this candidate." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not fetch the document." }, { status: 502 });
  }

  const bytes = Buffer.from(proof.base64, "base64");
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": proof.contentType || "application/octet-stream",
      // inline so HR can just look at it; filename kept for saving
      "content-disposition": `inline; filename="${proof.fileName.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
