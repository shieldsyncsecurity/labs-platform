import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { buildTextPdf } from "@/lib/pdf/text-pdf";
import { buildCertificateText, type SignedDocRecord } from "@/lib/sign/certificate";

export const dynamic = "force-dynamic";

// Public: download the acceptance certificate as a PDF. Bearer = the signing
// token the signer already holds; only a SIGNED document has a certificate.
// The PDF's every-page footer carries the document sha256 (text-pdf contract),
// so a printed certificate stays verifiable against the stored record.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  let doc: SignedDocRecord;
  try {
    doc = await entFetch<SignedDocRecord>("/ent/doc", { query: { docToken: token } });
  } catch (err) {
    if (err instanceof EntEngineError && (err.status === 404 || err.status === 410)) {
      return NextResponse.json({ error: "Not available." }, { status: err.status });
    }
    console.error("[api/sign/certificate] engine error", err);
    return NextResponse.json({ error: "Could not load the record." }, { status: 502 });
  }

  if (doc.status !== "signed") {
    return NextResponse.json({ error: "Not accepted yet." }, { status: 409 });
  }

  const cert = buildCertificateText(doc);
  const pdfBytes = buildTextPdf({ title: cert.title, bodyText: cert.bodyText, hash: cert.hash });

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="shieldsync-acceptance-certificate.pdf"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
