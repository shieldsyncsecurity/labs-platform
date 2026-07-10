import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch } from "@/lib/server/ent-engine";
import AdminNav from "../_components/admin-nav";
import LeadsTable, { type Lead } from "./leads-table";

export const metadata: Metadata = {
  title: "Leads",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLeadsPage() {
  // getAdminSession() is the ONLY source of truth for "is this staff signed
  // in" -- never infer it from anything else on this page.
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  let leads: Lead[] = [];
  let leadsError: string | null = null;
  try {
    const data = await entFetch<{ leads?: Lead[] }>("/ent/leads");
    leads = data?.leads ?? [];
  } catch {
    leadsError = "Could not load leads right now.";
  }

  const open = leads.filter((l) => l.status !== "closed").length;

  return (
    <div>
      <AdminNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <h1 className="text-2xl font-bold text-ink">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            Demo and pricing requests from the public site ({open} open). Every new lead also
            lands in the ops inbox by email.
          </p>
        </div>

        {leadsError ? (
          <p className="mt-8 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            {leadsError}
          </p>
        ) : (
          <LeadsTable initialLeads={leads} />
        )}
      </div>
    </div>
  );
}
