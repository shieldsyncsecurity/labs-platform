import { buildPayslip } from "@/lib/payslip";
import { PayslipDoc } from "@/components/PayslipDoc";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Payslip preview", robots: { index: false, follow: false } };

// Dev/verify page: renders a payslip through the real component + module so the
// slip format can be eyeballed without opening a real employee record.
//
// SAMPLE DATA ONLY — deliberately fictional. This page is reachable from the
// dashboard, so a real employee's PAN, bank account and IFSC here would expose
// exactly the sensitive personal data this portal exists to protect. Keep every
// identifier below fake.
export default function PayslipPreview() {
  const payslip = buildPayslip({
    employee: {
      name: "Aarav Sample",
      employeeId: "SSS/EMP/SAMPLE",
      designation: "GRC Analyst",
      department: "Governance, Risk & Compliance (GRC)",
      dateOfJoining: "02 March 2026",
      pan: "ABCDE1234F",
      bankAccount: "XXXXXXXX0000",
      bankBranch: "Sample Bank, Sector 62 Noida",
      ifsc: "SMPL0000000",
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
