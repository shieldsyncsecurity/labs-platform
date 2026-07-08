import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import AdminNav from "../_components/admin-nav";
import EraseForm from "./erase-form";

export const metadata: Metadata = {
  title: "Data requests",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ShieldSync-staff tool to action a candidate's data-erasure request
// (DPDP / GDPR right to be forgotten), which the privacy policy routes to
// privacy@shieldsyncsecurity.com. Redacts the candidate's name, email and
// written reflection in place; the anonymized score skeleton is retained for
// the employer's legitimate record.
export default async function AdminErasePage() {
  if (!(await getAdminSession())) {
    redirect("/admin/login");
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Data requests</h1>
        <p className="mt-1 text-sm text-muted">
          Action a candidate&apos;s right-to-erasure request (DPDP / GDPR).
        </p>

        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Erase candidate data</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Paste the candidate&apos;s invite token (the last path segment of their
            assessment link, <span className="font-mono">/a/&lt;token&gt;</span>, also shown in the
            employer&apos;s candidate list). This permanently redacts their name, email and written
            reflection. The assessment&apos;s anonymized score is kept for the employer&apos;s
            records. This cannot be undone.
          </p>
          <div className="mt-4">
            <EraseForm />
          </div>
        </div>
      </div>
    </div>
  );
}
