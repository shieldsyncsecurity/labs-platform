import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch } from "@/lib/server/ent-engine";
import AdminNav from "../_components/admin-nav";
import DocumentsTable, { type DocRow } from "./documents-table";

// Staff view of the doc-signing portal: every registered document + status.
// Rows show 8-char display ids ONLY -- the full signing link is disclosed
// exactly once, on the register screen; after that the recovery paths are
// "Resend link email" (to the registered signer) or revoke + re-register.
export const metadata: Metadata = {
  title: "Documents",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type EngineDoc = DocRow & { docToken?: string };

export default async function AdminDocumentsPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  let docs: DocRow[] = [];
  let docsError: string | null = null;
  try {
    const data = await entFetch<{ docs?: EngineDoc[] }>("/ent/docs");
    // Strip tokens server-side; the client component never sees them.
    docs = (data.docs ?? []).map((d) => ({
      id: (d.docToken ?? "").slice(0, 8),
      title: d.title ?? "",
      fileName: d.fileName ?? "",
      signerName: d.signerName ?? "",
      signerEmail: d.signerEmail ?? "",
      note: d.note ?? "",
      status: d.status ?? "",
      sizeBytes: d.sizeBytes ?? 0,
      createdAt: d.createdAt ?? "",
      expiresAt: d.expiresAt ?? "",
      acceptedAt: d.acceptedAt,
      acceptedName: d.acceptedName,
    }));
  } catch {
    docsError = "Could not load documents right now.";
  }

  const pending = docs.filter((d) => d.status === "pending").length;

  return (
    <div>
      <AdminNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">Documents</h1>
            <p className="mt-1 text-sm text-muted">
              Proposals, SOWs and agreements sent for electronic acceptance ({pending} awaiting
              signature). One universal flow -- register any PDF with a named signer.
            </p>
          </div>
          <Link
            href="/admin/documents/new"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Register document
          </Link>
        </div>

        {/* SES sandbox note -- remove once production sending access is granted. */}
        <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Email delivery note:</strong> SES is still in sandbox mode, so signing-link and
          code emails only reach <em>verified</em> recipient addresses. For other signers, copy the
          signing link at registration and send it yourself -- and verify their address in SES if
          they'll need the one-time code by email (the code email is required to accept).
        </p>

        {docsError ? (
          <p className="mt-8 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            {docsError}
          </p>
        ) : (
          <DocumentsTable initialDocs={docs} />
        )}
      </div>
    </div>
  );
}
