import Link from "next/link";
import { EmployeeForm } from "@/components/EmployeeForm";

export const metadata = { title: "Add employee — ShieldSync HR", robots: { index: false, follow: false } };

export default function NewEmployeePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/employees" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Employees</Link>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6, marginBottom: 4 }}>Add employee</h1>
      <p style={{ fontSize: 12.5, color: "#5b6676" }}>The record feeds the appointment letter and payslip generators. The engine assigns the next Employee ID.</p>
      <div style={{ marginTop: 8 }}>
        <EmployeeForm />
      </div>
    </main>
  );
}
