import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import PortalNav from "../../_components/portal-nav";
import NewAssessmentForm from "./new-assessment-form";

export const metadata: Metadata = {
  title: "Create assessment",
  robots: { index: false, follow: false },
};

export default async function NewAssessmentPage() {
  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  return (
    <div>
      <PortalNav orgId={orgId} />
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Create assessment</h1>
        <p className="mt-1 text-sm text-muted">
          Pick a lab and give this assessment a name your team will recognize.
        </p>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          <NewAssessmentForm />
        </div>
      </div>
    </div>
  );
}
