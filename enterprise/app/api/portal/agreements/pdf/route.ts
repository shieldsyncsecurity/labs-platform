import { NextResponse } from "next/server";
import { getOrgId } from "@/lib/server/portal-session";
import { getOrgAgreement } from "@/lib/server/agreement-gate";
import { DOC_TYPE_LABELS, type AgreementDocType } from "@/lib/legal/templates";
import { buildTextPdf } from "@/lib/pdf/text-pdf";

export const dynamic = "force-dynamic";

// Employer-facing: download an agreement as a PDF (sprint W3-6). Fail-closed
// org gate: the session org must own the agreement (getOrgAgreement), and
// drafts/foreign/missing ids all 404 identically. The printed SHA-256 is the
// engine-stored hash of the canonical bodyText, so a recipient can verify the
// document against the portal record.
export async function GET(req: Request) {
  const orgId = await getOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const agreementId = searchParams.get("id")?.trim() ?? "";
  if (!agreementId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let agreement;
  try {
    agreement = await getOrgAgreement(orgId, agreementId);
  } catch (err) {
    console.error("[portal/agreements/pdf] load failed", err);
    return NextResponse.json({ error: "Could not load the agreement." }, { status: 502 });
  }
  if (!agreement) {
    return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
  }

  const docType = (agreement.docType ?? "msa") as AgreementDocType;
  const docLabel = DOC_TYPE_LABELS[docType] ?? "Agreement";
  const title = `${docLabel} (${agreement.templateVersion ?? "unversioned"})`;

  const pdf = buildTextPdf({
    title,
    bodyText: agreement.bodyText ?? "",
    hash: agreement.sha256 ?? "unavailable",
  });

  // shieldsync-<doctype>-<id8>.pdf -- 8-char display prefix, never the full
  // id (matches the roster's display-prefix convention).
  const id8 = agreementId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "document";
  const filename = `shieldsync-${docType}-${id8}.pdf`;

  // Uint8Array is a valid web Response body; the cast only papers over the
  // TS 5.x Uint8Array<ArrayBufferLike> vs BodyInit lib quirk (same shape as
  // the admin PDF route).
  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
