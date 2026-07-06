import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAdminSession } from "@/lib/server/admin-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import AdminNav from "../../_components/admin-nav";
import CopyButton from "../../../portal/_components/copy-button";
import AdjustCreditsForm from "./adjust-credits-form";
import { Bar, formatDate } from "../../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Organization",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Org = {
  orgId?: string;
  name?: string;
  adminEmails?: string[];
  creditsTotal?: number;
  creditsUsed?: number;
  gstin?: string;
  status?: string;
  createdAt?: string;
};

type Assessment = {
  assessmentId?: string;
  name?: string;
  reportToken?: string;
  createdAt?: string;
};

const REPORT_BASE_URL = "https://enterprise.shieldsyncsecurity.com";

export default async function AdminOrgDetailPage({
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

  let assessments: Assessment[] = [];
  let assessmentsError: string | null = null;
  try {
    const data = await entFetch<Assessment[] | { assessments?: Assessment[] }>(
      "/ent/assessments",
      { query: { orgId } },
    );
    assessments = Array.isArray(data) ? data : (data?.assessments ?? []);
  } catch {
    assessmentsError = "Could not load assessments right now.";
  }

  const creditsTotal = org.creditsTotal ?? 0;
  const creditsUsed = org.creditsUsed ?? 0;
  const usedPct = creditsTotal > 0 ? Math.min(100, (creditsUsed / creditsTotal) * 100) : 0;
  const adminEmails = org.adminEmails ?? [];

  return (
    <div>
      <AdminNav />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <h1 className="text-2xl font-bold text-ink">{org.name ?? "Untitled org"}</h1>
          <p className="mt-1 font-mono text-xs text-muted">{org.orgId ?? orgId}</p>
          <p className="mt-1 text-sm text-muted">
            Status: {org.status ?? "—"} · Created {formatDate(org.createdAt)}
          </p>
        </div>

        {/* Paste-into-dev-login helper */}
        <div className="mt-4 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-xs text-ink-soft">
          <span className="font-semibold text-brand-strong">Org id:</span>{" "}
          <span className="font-mono">{org.orgId ?? orgId}</span> — paste this into the employer
          dev-login to sign in as this org.
        </div>

        {/* Credits summary + adjustment */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Credits</h2>
          <p className="mt-1 text-2xl font-bold text-ink">
            {creditsUsed}
            <span className="ml-1 text-base font-normal text-muted">/ {creditsTotal} used</span>
          </p>
          <div className="mt-2 max-w-sm">
            <Bar pct={usedPct} />
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <h3 className="text-sm font-semibold text-ink-soft">Adjust credits</h3>
            <p className="mt-1 text-xs text-muted">
              Positive numbers add credits, negative numbers remove them.
            </p>
            <div className="mt-3">
              <AdjustCreditsForm orgId={org.orgId ?? orgId} />
            </div>
          </div>
        </div>

        {/* Org details */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Details</h2>
          <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Admin email(s)</dt>
              <dd className="mt-1 text-sm text-ink-soft">
                {adminEmails.length > 0 ? adminEmails.join(", ") : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">GSTIN</dt>
              <dd className="mt-1 font-mono text-sm text-ink-soft">{org.gstin || "—"}</dd>
            </div>
          </dl>
        </div>

        {/* Assessments */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Assessments</h2>
          {assessmentsError ? (
            <p className="text-sm text-rose-700">{assessmentsError}</p>
          ) : assessments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
              <p className="text-ink-soft">No assessments for this org yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">Report link</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a, i) => {
                    const reportLink = a.reportToken
                      ? `${REPORT_BASE_URL}/r/${a.reportToken}`
                      : null;
                    return (
                      <tr
                        key={a.assessmentId ?? i}
                        className="border-b border-line last:border-b-0 hover:bg-canvas"
                      >
                        <td className="px-4 py-3 font-semibold text-ink">
                          {a.name ?? "Untitled assessment"}
                        </td>
                        <td className="px-4 py-3 text-ink-soft">{formatDate(a.createdAt)}</td>
                        <td className="px-4 py-3">
                          {reportLink ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="min-w-0 max-w-xs truncate rounded-lg border border-line bg-canvas px-2 py-1 font-mono text-xs text-ink-soft">
                                {reportLink}
                              </span>
                              <CopyButton value={reportLink} label="Copy" />
                            </div>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
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
