import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";
import { DOC_TYPE_LABELS } from "@/lib/legal/templates";
import { buildTextPdf, sanitizeToAscii } from "@/lib/pdf/text-pdf";
import { isAgreementDocType, type AgreementParams } from "../_lib/shared";

type AgreementRow = {
  agreementId?: string;
  orgId?: string;
  docType?: string;
  params?: AgreementParams;
  bodyText?: string;
  sha256?: string;
  status?: string;
};

export const dynamic = "force-dynamic";

// Staff-only (W3-6): download any agreement as a PDF. Read-only, so the
// boolean getAdminSession() gate is the right shape (no mutation => no actor
// to record) -- still fail-closed like every app/api/admin/* route. The PDF
// carries the stored sha256 in its footer so a printed copy stays verifiable
// against the engine record.
export async function GET(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(req.url);
  const agreementId = (url.searchParams.get("id") ?? "").trim();
  if (!agreementId) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  let agreement: AgreementRow;
  try {
    agreement = await entFetch<AgreementRow>("/ent/agreement", { query: { agreementId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the agreement." }, { status: 502 });
  }

  const bodyText = agreement.bodyText ?? "";
  if (!bodyText) {
    return NextResponse.json({ error: "Agreement has no body text." }, { status: 404 });
  }

  const docLabel = isAgreementDocType(agreement.docType)
    ? DOC_TYPE_LABELS[agreement.docType]
    : "Agreement";
  const company = agreement.params?.companyLegalName ?? "";
  const title = sanitizeToAscii(company ? `${docLabel} -- ${company}` : docLabel);

  const pdfBytes = buildTextPdf({
    title,
    bodyText: sanitizeToAscii(bodyText),
    hash: agreement.sha256 ?? "",
  });

  // Filename: docType + a short display prefix of the id (never leaks more
  // than the URL the admin already used).
  const idPrefix = agreementId.slice(0, 8);
  const filename = `shieldsync-${agreement.docType ?? "agreement"}-${idPrefix}.pdf`;

  return new Response(pdfBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
