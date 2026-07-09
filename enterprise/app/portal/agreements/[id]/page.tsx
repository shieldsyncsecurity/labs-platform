import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { getOrgAgreement, type AgreementFull } from "@/lib/server/agreement-gate";
import { DOC_TYPE_LABELS, type AgreementDocType } from "@/lib/legal/templates";
import PortalNav from "../../_components/portal-nav";
import { formatDate } from "../../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Agreement",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  // getOrgAgreement carries the ownership proof: a foreign/draft/missing id
  // all fail identically as 404 (no oracle). Engine transport errors throw
  // and land on the portal error boundary.
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

  const docLabel =
    DOC_TYPE_LABELS[agreement.docType as AgreementDocType] ?? "Agreement";
  const pdfHref = `/api/portal/agreements/pdf?id=${encodeURIComponent(id)}`;

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              <Link href="/portal/agreements" className="hover:text-brand-strong hover:underline">
                Agreements
              </Link>{" "}
              / {docLabel}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-ink">{docLabel}</h1>
            <p className="mt-1 text-sm text-muted">
              {agreement.templateVersion ?? ""}
              {agreement.customized ? " \u00B7 negotiated terms" : ""}
              {agreement.issuedAt ? ` \u00B7 issued ${formatDate(agreement.issuedAt)}` : ""}
              {agreement.acceptedAt
                ? ` \u00B7 accepted ${formatDate(agreement.acceptedAt)}${
                    agreement.acceptedBy ? ` by ${agreement.acceptedBy}` : ""
                  }`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {agreement.status === "issued" ? (
              <Link
                href={`/portal/agreements/${encodeURIComponent(id)}/accept`}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
              >
                Review &amp; accept
              </Link>
            ) : null}
            <a
              href={pdfHref}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-brand-strong"
            >
              Download PDF
            </a>
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap px-6 py-6 font-serif text-[15px] leading-7 text-ink">
            {agreement.bodyText ?? ""}
          </pre>
        </div>

        <p className="mt-4 break-all font-mono text-xs text-muted">
          SHA-256: {agreement.sha256 ?? "unavailable"}
        </p>
      </div>
    </div>
  );
}
