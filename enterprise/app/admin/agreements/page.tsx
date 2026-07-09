import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import AdminNav from "../_components/admin-nav";
import AgreementLookupForm from "./lookup-form";

export const metadata: Metadata = {
  title: "Agreements",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Staff-only (W3-4): agreements landing. Agreements are stored per-org (the
// engine only lists by orgId), so this page routes staff to the right place:
// the org's Agreements section for browsing/creating, or a direct jump when
// they already hold an agreement id (e.g. from an audit line or a PDF).
export default async function AdminAgreementsIndexPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Agreements</h1>
        <p className="mt-1 text-sm text-muted">
          Enterprise Agreements and DPAs are permanent legal records kept per organization.
        </p>

        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Browse by organization</h2>
          <p className="mt-1 text-xs text-muted">
            Each org detail page has an Agreements section: the full list, a New agreement flow,
            and per-document view / issue / void / PDF.
          </p>
          <Link
            href="/admin"
            className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Open organizations
          </Link>
        </div>

        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Jump to an agreement</h2>
          <p className="mt-1 text-xs text-muted">
            Paste an agreement id (from an audit line, a PDF filename, or the org page).
          </p>
          <div className="mt-3">
            <AgreementLookupForm />
          </div>
        </div>
      </div>
    </div>
  );
}
