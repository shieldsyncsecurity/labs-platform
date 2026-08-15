import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { projectEmployee } from "@/lib/server/employee-view";
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

  // This page (a Server Component) fetched the RAW record and passed it straight
  // to the form, which pre-fills bankAccount/IFSC/PAN as defaultValue — i.e. it
  // serialized them into the HTML for a viewer who may lack seeBankDetails (the
  // detail page masks them and the API GET strips them, but this form didn't).
  // Project first, exactly like /api/employees/[seq]. The PUT route restores the
  // stripped fields from the stored record so saving can't wipe them.
  const viewer = await getViewer();
  const initial = projectEmployee(e, viewer) as Employee;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6, marginBottom: 4 }}>Edit employee</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>
        <span style={{ fontFamily: "monospace" }}>{e.employeeId}</span> — changes are logged in the audit trail.
      </p>
      <div style={{ marginTop: 8 }}>
        <EmployeeForm seq={seq} initial={initial} />
      </div>
    </main>
  );
}
