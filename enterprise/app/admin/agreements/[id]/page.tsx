import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import AdminNav from "../../_components/admin-nav";
import CopyButton from "../../../portal/_components/copy-button";
import {
  AgreementStatusPill,
  CustomizedBadge,
  NegotiatedBanner,
  docTypeLabel,
} from "../../_components/agreement-bits";
import AgreementActions from "./agreement-actions";
import { formatDate } from "../../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Agreement",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type AgreementRow = {
  agreementId?: string;
  orgId?: string;
  docType?: string;
  templateVersion?: string;
  params?: Record<string, string>;
  bodyText?: string;
  customized?: boolean;
  sha256?: string;
  status?: string;
  createdAt?: string;
  createdBy?: string;
  supersedes?: string;
  updatedAt?: string;
  issuedAt?: string;
  issuedBy?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  voidedAt?: string;
  voidedBy?: string;
  supersededAt?: string;
  supersededBy?: string;
};

const PARAM_LABELS: [string, string][] = [
  ["companyLegalName", "Company legal name"],
  ["registeredAddress", "Registered address"],
  ["gstin", "GSTIN"],
  ["signatoryName", "Signatory name"],
  ["signatoryTitle", "Signatory title"],
  ["effectiveDate", "Effective date"],
  ["governingLaw", "Governing law"],
];

// Timeline entry: "who did what when", rendered only when stamped.
function Stamp({ label, at, by }: { label: string; at?: string; by?: string }) {
  if (!at && !by) return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink-soft">
        {formatDate(at)}
        {by ? <span className="text-xs text-muted"> by {by}</span> : null}
      </dd>
    </div>
  );
}

// Staff-only (W3-4): the permanent record view of one agreement -- full text,
// sha256, params, status timeline -- plus the status-gated actions (edit
// draft text / issue / void / download PDF).
export default async function AdminAgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  let agreement: AgreementRow | undefined;
  try {
    agreement = await entFetch<AgreementRow>("/ent/agreement", {
      query: { agreementId: id },
    });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      notFound();
    }
    return (
      <div>
        <AdminNav />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-sm text-rose-700">Could not load this agreement right now.</p>
        </div>
      </div>
    );
  }
  if (!agreement) {
    notFound();
  }

  const p = agreement.params ?? {};

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-5xl px-6 py-10">
        {agreement.orgId ? (
          <p className="text-xs text-muted">
            <Link href={`/admin/orgs/${agreement.orgId}`} className="hover:text-brand-strong">
              &larr; Back to organization
            </Link>
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{docTypeLabel(agreement.docType)}</h1>
          <AgreementStatusPill status={agreement.status} />
          {agreement.customized ? <CustomizedBadge /> : null}
        </div>
        <p className="mt-1 font-mono text-xs text-muted">{agreement.agreementId ?? id}</p>
        <p className="mt-1 text-sm text-muted">
          Template {agreement.templateVersion ?? "\u2014"} &middot; Created{" "}
          {formatDate(agreement.createdAt)}
          {agreement.createdBy ? ` by ${agreement.createdBy}` : ""}
        </p>

        {agreement.customized ? (
          <div className="mt-4">
            <NegotiatedBanner />
          </div>
        ) : null}

        {/* Actions (status-gated, 2-step confirms live in the client component) */}
        <div className="mt-5">
          <AgreementActions
            agreementId={agreement.agreementId ?? id}
            status={agreement.status ?? ""}
            docType={agreement.docType ?? ""}
            params={p}
            bodyText={agreement.bodyText ?? ""}
          />
        </div>

        {/* Integrity: the sha256 of the stored body text (engine-maintained). */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Integrity</h2>
          <p className="mt-1 text-xs text-muted">
            SHA-256 of the stored text. Re-stored at issue time; printed in every PDF footer.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all rounded-lg border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink-soft">
              {agreement.sha256 ?? "\u2014"}
            </span>
            {agreement.sha256 ? <CopyButton value={agreement.sha256} label="Copy" /> : null}
          </div>
        </div>

        {/* Params + lifecycle timeline */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Parameters</h2>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PARAM_LABELS.map(([key, label]) => (
              <div key={key}>
                <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                <dd className="mt-1 text-sm text-ink-soft">{p[key] || "\u2014"}</dd>
              </div>
            ))}
            {agreement.supersedes ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Supersedes</dt>
                <dd className="mt-1 text-sm">
                  <Link
                    href={`/admin/agreements/${agreement.supersedes}`}
                    className="font-mono text-xs text-brand-strong hover:underline"
                  >
                    {agreement.supersedes.slice(0, 8)}&hellip;
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>

          <h3 className="mt-5 border-t border-line pt-5 text-sm font-semibold text-ink-soft">
            Lifecycle
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stamp label="Created" at={agreement.createdAt} by={agreement.createdBy} />
            <Stamp label="Issued" at={agreement.issuedAt} by={agreement.issuedBy} />
            <Stamp label="Accepted" at={agreement.acceptedAt} by={agreement.acceptedBy} />
            <Stamp label="Voided" at={agreement.voidedAt} by={agreement.voidedBy} />
            <Stamp label="Superseded" at={agreement.supersededAt} by={agreement.supersededBy} />
            {agreement.updatedAt ? (
              <Stamp label="Last edited" at={agreement.updatedAt} />
            ) : null}
          </dl>
        </div>

        {/* Full text (read view -- editing happens via the Actions component) */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Full text</h2>
          <pre className="mt-3 max-h-[36rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas px-4 py-3 font-mono text-xs leading-5 text-ink-soft">
            {agreement.bodyText ?? ""}
          </pre>
        </div>
      </div>
    </div>
  );
}
