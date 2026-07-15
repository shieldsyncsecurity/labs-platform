import { NextResponse } from "next/server";
import { entFetch } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";
import { buildTextPdf } from "@/lib/pdf/text-pdf";
import { buildCertificateText, type SignedDocRecord } from "@/lib/sign/certificate";

export const dynamic = "force-dynamic";

// Staff copy of the acceptance certificate, addressed by 8-char display id
// (read-only => boolean admin gate). Renders from the SAME builder as the
// public /api/sign/certificate so the two copies can never differ.
export async function GET(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(id)) {
    return NextResponse.json({ error: "id must be the 8-char display id" }, { status: 400 });
  }

  type EngineDoc = SignedDocRecord & { docToken?: string };
  let doc: EngineDoc | undefined;
  try {
    const data = await entFetch<{ docs?: EngineDoc[] }>("/ent/docs");
    const matches = (data.docs ?? []).filter((d) => (d.docToken ?? "").startsWith(id));
    doc = matches.length === 1 ? matches[0] : undefined;
  } catch (err) {
    console.error("[api/admin/documents/certificate] list failed", err);
    return NextResponse.json({ error: "Could not look up the document." }, { status: 502 });
  }
  if (!doc) return NextResponse.json({ error: "No unique document matches that id." }, { status: 404 });
  if (doc.status !== "signed") {
    return NextResponse.json({ error: "Not accepted yet." }, { status: 409 });
  }

  const cert = buildCertificateText(doc);
  const pdfBytes = buildTextPdf({ title: cert.title, bodyText: cert.bodyText, hash: cert.hash });

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="shieldsync-acceptance-certificate-${id}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
