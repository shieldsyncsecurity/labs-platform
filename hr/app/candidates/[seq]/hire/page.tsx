import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { HireCandidateForm } from "@/components/HireCandidateForm";
import type { Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hire candidate — ShieldSync HR", robots: { index: false, follow: false } };

const str = (v: string | string[] | undefined): string | undefined => {
  if (v === undefined) return undefined;
  const s = Array.isArray(v) ? v.join(", ") : String(v);
  return s.trim() || undefined;
};

export default async function HireCandidate({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let c: Candidate;
  try {
    c = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${seq}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }
  if (c.convertedSeq) redirect(`/employees/${c.convertedSeq}`);

  // Prefill from what the candidate told us themselves — no re-typing.
  const a = c.answers ?? {};
  const prefill = {
    name: str(a.fullName) ?? c.name,
    email: str(a.email) ?? c.email,
    phone: str(a.mobile) ?? c.phone,
    roleAppliedFor: c.roleAppliedFor,
    expectedCtc: str(a.expectedCtc),
    earliestStart: str(a.earliestStart),
    noticePeriod: str(a.noticePeriod),
    currentCity: str(a.currentCity),
  };

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/candidates/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {c.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Hire {c.name}</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676", marginBottom: 8 }}>
        Creates the employee record and opens their offer letter. {c.submittedAt ? "Prefilled from their questionnaire — check each field." : "They haven't submitted the questionnaire, so there's little to prefill."}
      </p>
      <p style={{ fontSize: 11.5, color: "#8a94a3", marginBottom: 16 }}>
        The hiring record <span style={{ fontFamily: "monospace" }}>{c.candidateId}</span> stays as the evidence of how they were recruited.
      </p>
      <HireCandidateForm seq={seq} prefill={prefill} />
    </main>
  );
}
