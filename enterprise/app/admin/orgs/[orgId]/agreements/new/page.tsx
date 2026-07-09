import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import AdminNav from "../../../../_components/admin-nav";
import NewAgreementForm, { type ExistingAgreementOption } from "./new-agreement-form";

export const metadata: Metadata = {
  title: "New agreement",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Org = {
  orgId?: string;
  name?: string;
};

type AgreementListRow = {
  agreementId?: string;
  docType?: string;
  status?: string;
  createdAt?: string;
};

// Staff-only (W3-4): create a new Enterprise Agreement / DPA draft for one
// org. Server side only gates + prefills (org name -> companyLegalName and the
// org's existing agreements for the optional supersedes picker); the render /
// edit / customized logic is all in the client form.
export default async function NewAgreementPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  let org: Org | undefined;
  try {
    org = await entFetch<Org>("/ent/orgs", { query: { orgId } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      notFound();
    }
    return (
      <div>
        <AdminNav />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-sm text-rose-700">Could not load this organization right now.</p>
        </div>
      </div>
    );
  }
  if (!org) {
    notFound();
  }

  // Existing agreements feed the optional "supersedes" picker. Non-fatal: the
  // form still works without them (supersedes is optional; the engine does a
  // best-effort supersede cascade at issue time anyway).
  let existing: ExistingAgreementOption[] = [];
  try {
    const data = await entFetch<{ agreements?: AgreementListRow[] }>("/ent/agreements", {
      query: { orgId },
    });
    existing = (Array.isArray(data?.agreements) ? data.agreements : [])
      .filter((a) => a.agreementId && (a.status === "issued" || a.status === "accepted"))
      .map((a) => ({
        agreementId: a.agreementId as string,
        docType: a.docType ?? "",
        status: a.status ?? "",
        createdAt: a.createdAt,
      }));
  } catch {
    existing = [];
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-xs text-muted">
          <Link href={`/admin/orgs/${orgId}`} className="hover:text-brand-strong">
            &larr; {org.name ?? "Organization"}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">New agreement</h1>
        <p className="mt-1 text-sm text-muted">
          Pick the document type, fill the mandatory parameters, preview the render, then save the
          draft. Drafts stay editable until issued.
        </p>

        <div className="mt-6">
          <NewAgreementForm
            orgId={org.orgId ?? orgId}
            orgName={org.name ?? ""}
            existingAgreements={existing}
          />
        </div>
      </div>
    </div>
  );
}
