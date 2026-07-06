import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getOrgId } from "@/lib/server/portal-session";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import PortalNav from "../../_components/portal-nav";
import CopyButton from "../../_components/copy-button";
import AddCandidateForm from "./add-candidate-form";
import InvitesTable, { type InviteRow } from "./invites-table";
import { formatDate } from "../../../r/_components/report-bits";

export const metadata: Metadata = {
  title: "Assessment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Assessment = {
  assessmentId?: string;
  orgId?: string;
  name?: string;
  labSlug?: string;
  hintsOn?: boolean;
  createdAt?: string;
  reportToken?: string;
};

const APP_URL = "https://enterprise.shieldsyncsecurity.com";

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const orgId = await getOrgId();
  if (!orgId) {
    redirect("/portal/login");
  }

  let assessment: Assessment | undefined;
  try {
    assessment = await entFetch<Assessment>("/ent/assessment", { query: { assessmentId: id } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      notFound();
    }
    return (
      <div>
        <PortalNav orgId={orgId} />
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-sm text-rose-700">Could not load this assessment right now.</p>
        </div>
      </div>
    );
  }

  // CRITICAL: re-verify ownership. An employer must never see another org's
  // assessment, even if they guess/enumerate a valid assessmentId -- fail
  // exactly like a real 404, not a "forbidden" page that would confirm the
  // id exists.
  if (!assessment || assessment.orgId !== orgId) {
    notFound();
  }

  let invites: InviteRow[] = [];
  let invitesError: string | null = null;
  try {
    const data = await entFetch<InviteRow[] | { invites?: InviteRow[] }>("/ent/invites", {
      query: { assessmentId: id },
    });
    invites = Array.isArray(data) ? data : (data?.invites ?? []);
  } catch {
    invitesError = "Could not load candidates right now.";
  }

  const reportLink = assessment.reportToken ? `${APP_URL}/r/${assessment.reportToken}` : null;

  return (
    <div>
      <PortalNav orgId={orgId} />

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <h1 className="text-2xl font-bold text-ink">{assessment.name ?? "Untitled assessment"}</h1>
          <p className="mt-1 text-sm text-muted">
            {assessment.labSlug ? <span className="font-mono">{assessment.labSlug}</span> : null}
            {assessment.labSlug && assessment.createdAt ? " · " : null}
            {assessment.createdAt ? <span>Created {formatDate(assessment.createdAt)}</span> : null}
            {assessment.hintsOn !== undefined ? (
              <span> · Hints {assessment.hintsOn ? "on" : "off"}</span>
            ) : null}
          </p>
        </div>

        {/* Report link */}
        <div className="mt-6 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Report link</h2>
          <p className="mt-1 text-xs text-muted">
            Share this with your hiring team — it shows every candidate&apos;s results for this
            assessment as they complete it.
          </p>
          {reportLink ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink-soft">
                {reportLink}
              </span>
              <CopyButton value={reportLink} label="Copy link" />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">No report link available yet.</p>
          )}
        </div>

        {/* Add candidate */}
        <div className="mt-8 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-ink-soft">Add candidate</h2>
          <div className="mt-3">
            <AddCandidateForm assessmentId={id} />
          </div>
        </div>

        {/* Invites table */}
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Candidates</h2>
          {invitesError ? (
            <p className="text-sm text-rose-700">{invitesError}</p>
          ) : (
            <InvitesTable assessmentId={id} invites={invites} />
          )}
        </div>
      </div>
    </div>
  );
}
