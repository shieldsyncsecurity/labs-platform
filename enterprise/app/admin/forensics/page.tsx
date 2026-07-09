import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import AdminNav from "../_components/admin-nav";
import ForensicsForm from "./forensics-form";

export const metadata: Metadata = {
  title: "Forensics",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// ShieldSync-staff read-only dossier for one candidate invite, looked up by
// its token -- the dispute-handling counterpart of /admin/erase. When a
// candidate or employer reports a problem (E6), this is where staff see the
// invite's status, timeline, problem log and score summary in one place
// WITHOUT touching anything. The token is POSTed (never a query param) so a
// live candidate bearer credential doesn't land in URL history or logs.
export default async function AdminForensicsPage() {
  if (!(await getAdminSession())) {
    redirect("/admin/login");
  }

  return (
    <div>
      <AdminNav />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Forensics</h1>
        <p className="mt-1 text-sm text-muted">
          Look up a candidate invite by token: status, timeline, reported problems and score
          summary. Read-only &mdash; nothing here changes engine state.
        </p>

        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Invite lookup</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Paste the candidate&apos;s invite token (the last path segment of their assessment
            link, <span className="font-mono">/a/&lt;token&gt;</span>, also shown in the
            employer&apos;s candidate list and in problem-report emails).
          </p>
          <div className="mt-4">
            <ForensicsForm />
          </div>
        </div>
      </div>
    </div>
  );
}
