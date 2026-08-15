import { NextResponse } from "next/server";
import { getSelfSession } from "@/lib/server/self-session";
import { buildIssuedPdf, pdfFileName, PdfUnavailableError } from "@/lib/server/pdf";
import { HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Self-serve PDF download — same renderer as the admin route, but seq comes
// from the signed ss_self session, never from the URL, so this can only ever
// produce documents that belong to whoever is signed in.
export async function GET(req: Request, { params }: { params: Promise<{ genId: string }> }) {
  const session = await getSelfSession();
  if (!session) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { genId } = await params;

  try {
    const { pdf, gen, employeeName } = await buildIssuedPdf(req, String(session.seq), genId);
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${pdfFileName(gen, employeeName)}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return NextResponse.json(
        { error: "Server-side PDF is available after deployment. In dev, use Print → Save as PDF." },
        { status: 501 },
      );
    }
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }
    console.error("[self/pdf] render failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not render the PDF." }, { status: 502 });
  }
}
