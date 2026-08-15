import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { CandidateForm } from "@/components/CandidateForm";
import type { Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit candidate — ShieldSync HR", robots: { index: false, follow: false } };

export default async function EditCandidate({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let c: Candidate;
  try {
    c = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${seq}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/manage-candidates/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {c.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6, marginBottom: 16 }}>Edit candidate</h1>
      <CandidateForm candidate={c} />
    </main>
  );
}
