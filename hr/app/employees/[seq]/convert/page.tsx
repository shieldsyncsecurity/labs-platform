import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";
import { ConvertInternForm } from "@/components/ConvertInternForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Convert intern — ShieldSync HR", robots: { index: false, follow: false } };

export default async function ConvertPage({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  if (!/internship/i.test(e.employmentType)) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Convert to full-time</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>{e.name} is already full-time.</p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Convert intern to full-time</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>
        {e.name} — {e.designation}, interning since {e.dateOfJoining}. Conversion records the transition,
        keeps <span style={{ fontFamily: "monospace" }}>{e.employeeId}</span>, applies the full-time role +
        compensation, and takes you straight to the appointment letter.
      </p>
      <div style={{ marginTop: 12 }}>
        <ConvertInternForm seq={seq} currentDesignation={e.designation} />
      </div>
    </main>
  );
}
