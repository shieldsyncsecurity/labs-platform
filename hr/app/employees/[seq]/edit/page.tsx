import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";
import { EmployeeForm } from "@/components/EmployeeForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit employee — ShieldSync HR", robots: { index: false, follow: false } };

export default async function EditEmployeePage({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6, marginBottom: 4 }}>Edit employee</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>
        <span style={{ fontFamily: "monospace" }}>{e.employeeId}</span> — changes are logged in the audit trail.
      </p>
      <div style={{ marginTop: 8 }}>
        <EmployeeForm seq={seq} initial={e} />
      </div>
    </main>
  );
}
