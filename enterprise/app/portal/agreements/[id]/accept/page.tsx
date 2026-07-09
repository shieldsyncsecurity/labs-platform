import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { getOrgAgreement, type AgreementFull } from "@/lib/server/agreement-gate";
import { DOC_TYPE_LABELS, type AgreementDocType } from "@/lib/legal/templates";
import PortalNav from "../../../_components/portal-nav";
import { formatDate } from "../../../../r/_components/report-bits";
import AcceptAgreementForm from "./accept-form";

export const metadata: Metadata = {
  title: "Accept agreement",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// This page is the LANDING TARGET of the portal-wide agreement gate, so it
// must never itself be gated -- an org with a pending agreement can always
// reach it, read the full text, and accept.
export default async function AcceptAgreementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  let agreement: AgreementFull | null;
  try {
    agreement = await getOrgAgreement(orgId, id);
  } catch {
    return (
      <div>
        <PortalNav orgId={orgId} />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-sm text-rose-700">Could not load this agreement right now.</p>
        </div>
      </div>
    );
  }
  if (!agreement) {
    notFound();
  }

  // Only "issued" needs acceptance -- anything else lands on the read view.
  if (agreement.status !== "issued") {
    redirect(`/portal/agreements/${encodeURIComponent(id)}`);
  }

  const docLabel =
    DOC_TYPE_LABELS[agreement.docType as AgreementDocType] ?? "Agreement";
  const companyLegalName = agreement.params?.companyLegalName ?? "your organization";
  const pdfHref = `/api/portal/agreements/pdf?id=${encodeURIComponent(id)}`;

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Review and accept: {docLabel}</h1>
        <p className="mt-1 text-sm text-muted">
          {agreement.templateVersion ?? ""}
          {agreement.customized ? " \u00B7 negotiated terms" : ""}
          {agreement.issuedAt ? ` \u00B7 issued ${formatDate(agreement.issuedAt)}` : ""}
        </p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This agreement is awaiting acceptance. Access to the rest of the portal resumes once an
          authorized person at {companyLegalName} accepts it.{" "}
          <a href={pdfHref} className="font-semibold underline">
            Download PDF
          </a>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          <pre className="max-h-[32rem] max-w-full overflow-y-auto overflow-x-auto whitespace-pre-wrap px-6 py-6 font-serif text-[15px] leading-7 text-ink">
            {agreement.bodyText ?? ""}
          </pre>
        </div>

        <p className="mt-3 break-all font-mono text-xs text-muted">
          SHA-256: {agreement.sha256 ?? "unavailable"}
        </p>

        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <AcceptAgreementForm agreementId={id} companyLegalName={companyLegalName} />
        </div>

        <p className="mt-4 text-xs text-muted">
          Questions about these terms?{" "}
          <Link href="/portal/agreements" className="font-semibold text-brand-strong hover:underline">
            All agreements
          </Link>{" "}
          {"\u00B7"} or write to hello@shieldsyncsecurity.com before accepting.
        </p>
      </div>
    </div>
  );
}
