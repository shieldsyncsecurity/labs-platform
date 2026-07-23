import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { buildIssuedPdf, pdfFileName, PdfUnavailableError } from "@/lib/server/pdf";
import { hrFetch } from "@/lib/server/hr-engine";
import { HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Download an issued document as a server-rendered PDF (exact archived
// snapshot, same components as the screen). Audited as a document access.
export async function GET(req: Request, { params }: { params: Promise<{ seq: string; genId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq, genId } = await params;

  try {
    const { pdf, gen } = await buildIssuedPdf(req, seq, genId);
    try {
      await hrFetch("/hr/audit", {
        method: "POST",
        body: { actor, action: "doc.pdf", target: `${seq}/${genId}`, detail: { ref: gen.ref, docType: gen.docType } },
      });
    } catch {
      /* best-effort */
    }
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(gen)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return NextResponse.json(
        { error: "Server-side PDF is available after deployment (Browser Rendering). In dev, use Print → Save as PDF." },
        { status: 501 },
      );
    }
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    console.error("[pdf] render failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not render the PDF." }, { status: 502 });
  }
}
