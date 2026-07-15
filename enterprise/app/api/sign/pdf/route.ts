import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";

export const dynamic = "force-dynamic";

type DocPdf = {
  fileName?: string;
  sha256?: string;
  pdfBase64?: string;
};

// Public: serve the EXACT stored PDF for a signing link, inline (the /sign
// page embeds this URL in an <object>). The engine re-verifies the stored
// bytes against the registered sha256 on every read and fails closed, so what
// renders here is always what the acceptance record hashes.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  let doc: DocPdf;
  try {
    // Give the fetch headroom over the default 15s -- a ~5MB base64 body
    // through API Gateway can exceed it on a cold engine.
    doc = await entFetch<DocPdf>("/ent/doc/pdf", { query: { docToken: token }, timeoutMs: 25000 });
  } catch (err) {
    if (err instanceof EntEngineError && (err.status === 404 || err.status === 410)) {
      return NextResponse.json({ error: "Not available." }, { status: err.status });
    }
    console.error("[api/sign/pdf] engine error", err);
    return NextResponse.json({ error: "Could not load the document." }, { status: 502 });
  }

  if (!doc.pdfBase64) {
    return NextResponse.json({ error: "Could not load the document." }, { status: 502 });
  }
  const bytes = Buffer.from(doc.pdfBase64, "base64");
  const safeName = (doc.fileName ?? "document.pdf").replace(/[^\w. ()-]/g, "");

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      // inline: the signing page embeds it; the same URL doubles as the
      // download link via the browser's PDF viewer.
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
