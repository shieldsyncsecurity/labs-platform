import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { formatINR } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";
import { ReviseSalaryForm } from "@/components/ReviseSalaryForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revise salary — ShieldSync HR", robots: { index: false, follow: false } };

export default async function ReviseSalaryPage({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Revise salary</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>
        Current: <b>{formatINR(e.grossMonthly)}</b> / month (CTC {formatINR(e.annualCTC)}). Applying a revision
        records the old compensation in the history, updates the record, and issues a
        <b> Salary Revision Letter</b> (unified SSS/HR reference) in one step.
      </p>
      <div style={{ marginTop: 12 }}>
        <ReviseSalaryForm seq={seq} currentGross={e.grossMonthly} />
      </div>
    </main>
  );
}
