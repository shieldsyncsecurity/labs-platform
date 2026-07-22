import { buildPayslip } from "@/lib/payslip";
import { PayslipDoc } from "@/components/PayslipDoc";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Payslip preview", robots: { index: false, follow: false } };

// Dev/verify page: renders the March 2026 payslip (owner's finalized Diya data)
// through the real component + module, so the app output matches the signed slip.
// The live generator (task #4) will feed real employee data into the same doc.
export default function PayslipPreview() {
  const payslip = buildPayslip({
    employee: {
      name: "Diya Jain",
      employeeId: "SSS/EMP/0007",
      designation: "GRC Analyst",
      department: "Governance, Risk & Compliance (GRC)",
      dateOfJoining: "02 March 2026",
      pan: "CSRPJ6260N",
      bankAccount: "10254647001",
      bankBranch: "IDFC First Bank, Indirapuram",
      ifsc: "IDFB0021416",
      paymentMode: "Bank Transfer",
      uanPf: "Not Applicable",
    },
    period: {
      monthLabel: "March 2026",
      periodLabel: "02 - 31 March 2026",
      standardDays: 31,
      daysPaid: 30,
      lopDays: 0,
      payDate: "08 April 2026",
    },
    earnings: { basic: 15000, hra: 6000, conveyance: 1600, special: 7400, gross: 30000 },
    // No statutory components active — all deductions render 0.00, like the signed slip.
    deductionConfig: {},
    remarks:
      "Salary for March 2026 was credited to the employee's bank account on 08 April 2026 via bank transfer.",
  });

  return <PayslipDoc payslip={payslip} toolbar={<PrintButton />} />;
}
