import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getBlockingAgreement } from "@/lib/server/agreement-gate";
import PortalNav from "./_components/portal-nav";
import { formatDate } from "../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Org = {
  orgId?: string;
  name?: string;
  creditsTotal?: number;
  creditsUsed?: number;
};

type Assessment = {
  assessmentId?: string;
  orgId?: string;
  name?: string;
  labSlug?: string;
  hintsOn?: boolean;
  createdAt?: string;
};

export default async function PortalDashboardPage() {
  // getOrgId() is the ONLY source of truth for "which org is this" -- never
  // derive it from anything else on this page.
  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  // Agreement gate (W3-5): an issued-unaccepted agreement blocks the portal.
  const blocking = await getBlockingAgreement(orgId);
  if (blocking?.agreementId) {
    redirect(`/portal/agreements/${encodeURIComponent(blocking.agreementId)}/accept`);
  }

  let org: Org | null = null;
  let orgError: string | null = null;
  try {
    org = await entFetch<Org>("/ent/orgs", { query: { orgId } });
  } catch (err) {
    orgError =
      err instanceof EntEngineError && err.status === 404
        ? "Org not found."
        : "Could not load your account right now.";
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

  const creditsTotal = org?.creditsTotal ?? 0;
  const creditsUsed = org?.creditsUsed ?? 0;
  const creditsRemaining = Math.max(0, creditsTotal - creditsUsed);
  const remainingPct = creditsTotal > 0 ? (creditsRemaining / creditsTotal) * 100 : 0;
  const lowCredits = creditsTotal > 0 && remainingPct < 20;

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink">{org?.name ?? "Dashboard"}</h1>
            <p className="mt-1 text-sm text-muted">Assessments and candidate invites.</p>
          </div>
          <Link
            href="/portal/assessments/new"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            Create assessment
          </Link>
        </div>

        {/* Credits summary */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          {orgError ? (
            <p className="text-sm text-rose-700">{orgError}</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-soft">Credits remaining</h2>
                <Link href="/portal/billing" className="text-xs font-semibold text-brand-strong hover:underline">
                  Billing →
                </Link>
              </div>
              <p className="mt-1 text-3xl font-bold text-ink">
                {creditsRemaining}
                <span className="ml-1 text-base font-normal text-muted">/ {creditsTotal}</span>
              </p>
              {lowCredits ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Running low on credits — each candidate invite uses 1 credit.{" "}
                  <Link href="/portal/billing" className="font-semibold underline">
                    Request more
                  </Link>
                  .
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Assessments table */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Assessments</h2>

          {assessmentsError ? (
            <div className="rounded-xl border border-line bg-surface px-6 py-8 text-center text-sm text-rose-700">
              {assessmentsError}
            </div>
          ) : assessments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
              <p className="text-ink-soft">No assessments yet.</p>
              <Link
                href="/portal/assessments/new"
                className="mt-3 inline-block text-sm font-semibold text-brand-strong hover:underline"
              >
                Create your first assessment →
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Lab</th>
                    <th className="px-4 py-3 font-semibold">Hints</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a, i) => (
                    <tr
                      key={a.assessmentId ?? i}
                      className="border-b border-line last:border-b-0 hover:bg-canvas"
                    >
                      <td className="px-4 py-3">
                        {a.assessmentId ? (
                          <Link
                            href={`/portal/assessments/${encodeURIComponent(a.assessmentId)}`}
                            className="font-semibold text-ink hover:text-brand-strong hover:underline"
                          >
                            {a.name ?? "Untitled assessment"}
                          </Link>
                        ) : (
                          <span className="font-semibold text-ink">
                            {a.name ?? "Untitled assessment"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                        {a.labSlug ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-soft">{a.hintsOn ? "On" : "Off"}</td>
                      <td className="px-4 py-3 text-ink-soft">{formatDate(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
