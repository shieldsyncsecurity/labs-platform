import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { entFetch } from "@/lib/server/ent-engine";
import type { AgreementSummary } from "@/lib/server/agreement-gate";
import { DOC_TYPE_LABELS, type AgreementDocType } from "@/lib/legal/templates";
import PortalNav from "../_components/portal-nav";
import { formatDate } from "../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Agreements",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Portal-visible statuses. Drafts are internal working copies the admin is
// still editing/negotiating -- they must never leak to the customer, so they
// are filtered out here AND 404'd on the detail/PDF routes.
const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  issued: { label: "Awaiting acceptance", className: "border-amber-200 bg-amber-50 text-amber-800" },
  accepted: { label: "Accepted", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  superseded: { label: "Superseded", className: "border-line bg-canvas text-muted" },
  void: { label: "Void", className: "border-line bg-canvas text-muted" },
};

function docTypeLabel(docType?: string): string {
  return DOC_TYPE_LABELS[docType as AgreementDocType] ?? (docType ?? "Agreement");
}

export default async function AgreementsPage() {
  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  let agreements: AgreementSummary[] = [];
  let loadError: string | null = null;
  try {
    const data = await entFetch<{ agreements?: AgreementSummary[] }>("/ent/agreements", {
      query: { orgId },
    });
    agreements = (data?.agreements ?? []).filter((a) => a.status !== "draft");
  } catch {
    loadError = "Could not load agreements right now.";
  }

  // Newest first; issued (action-needed) rows float to the top.
  agreements.sort((a, b) => {
    const aIssued = a.status === "issued" ? 0 : 1;
    const bIssued = b.status === "issued" ? 0 : 1;
    if (aIssued !== bIssued) return aIssued - bIssued;
    return (b.issuedAt ?? b.createdAt ?? "").localeCompare(a.issuedAt ?? a.createdAt ?? "");
  });

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Agreements</h1>
        <p className="mt-1 text-sm text-muted">
          Legal agreements between your organization and ShieldSync. Accepted agreements stay
          available here permanently.
        </p>

        <div className="mt-6">
          {loadError ? (
            <div className="rounded-xl border border-line bg-surface px-6 py-8 text-center text-sm text-rose-700">
              {loadError}
            </div>
          ) : agreements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center text-sm text-ink-soft">
              No agreements yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-semibold">Document</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Issued</th>
                    <th className="px-4 py-3 font-semibold">Accepted</th>
                    <th className="px-4 py-3 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((a, i) => {
                    const chip = STATUS_CHIP[a.status ?? ""] ?? {
                      label: a.status ?? "Unknown",
                      className: "border-line bg-canvas text-muted",
                    };
                    const id = a.agreementId ?? "";
                    return (
                      <tr key={id || i} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-3">
                          <span className="font-semibold text-ink">{docTypeLabel(a.docType)}</span>
                          <span className="ml-2 font-mono text-xs text-muted">
                            {a.templateVersion ?? ""}
                          </span>
                          {a.customized ? (
                            <span className="ml-2 rounded-full border border-brand/30 bg-brand/5 px-2 py-0.5 text-[11px] font-semibold text-brand-strong">
                              Negotiated terms
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}
                          >
                            {chip.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{formatDate(a.issuedAt)}</td>
                        <td className="px-4 py-3 text-ink-soft">{formatDate(a.acceptedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          {id ? (
                            <span className="inline-flex items-center gap-3 whitespace-nowrap">
                              {a.status === "issued" ? (
                                <Link
                                  href={`/portal/agreements/${encodeURIComponent(id)}/accept`}
                                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong"
                                >
                                  Review &amp; accept
                                </Link>
                              ) : (
                                <Link
                                  href={`/portal/agreements/${encodeURIComponent(id)}`}
                                  className="text-xs font-semibold text-brand-strong hover:underline"
                                >
                                  View
                                </Link>
                              )}
                              <a
                                href={`/api/portal/agreements/pdf?id=${encodeURIComponent(id)}`}
                                className="text-xs font-semibold text-brand-strong hover:underline"
                              >
                                Download PDF
                              </a>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
