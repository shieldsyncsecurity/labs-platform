import Link from "next/link";
import { CandidateForm } from "@/components/CandidateForm";

export const metadata = { title: "Add candidate — ShieldSync HR", robots: { index: false, follow: false } };

export default function NewCandidate() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/manage-candidates" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Candidates</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Add a candidate</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676", marginBottom: 16 }}>
        Just enough to reach them — the rest comes from the questionnaire you send next. This is a hiring record, not an employee.
      </p>
      <CandidateForm />
    </main>
  );
}
