import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import AdminNav from "../../_components/admin-nav";
import NewOrgForm from "./new-org-form";

export const metadata: Metadata = {
  title: "Create organization",
  robots: { index: false, follow: false },
};

export default async function NewOrgPage() {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
    redirect("/admin/login");
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Create organization</h1>
        <p className="mt-1 text-sm text-muted">
          Provisions a new employer org on the enterprise engine.
        </p>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <NewOrgForm />
        </div>
      </div>
    </div>
  );
}
