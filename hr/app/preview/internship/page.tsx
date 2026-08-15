import { buildInternshipOffer } from "@/lib/documents/internship";
import { InternshipOfferDoc } from "@/components/InternshipOfferDoc";
import { PrintButton } from "@/components/PrintButton";
import type { Employee } from "@/lib/employee";

export const metadata = { title: "Internship offer preview", robots: { index: false, follow: false } };

// Dev/verify page: renders the real component + module so the internship letter
// format can be reviewed without creating an employee record.
//
// SAMPLE DATA ONLY — deliberately fictional name and address. This page is
// reachable from the dashboard, so a real person's details here would expose
// them to anyone browsing the portal.
export default function InternshipPreview() {
  const sample = {
    name: "Aarav Sample",
    address: "12, Sample Residency, Sector 62, Noida, Uttar Pradesh 201309",
    designation: "Executive Assistant Intern",
    department: "Administration",
    dateOfJoining: "01 August 2026",
    employmentType: "Internship",
    baseLocation: "Noida, Uttar Pradesh, India",
    reportingTo: "Founder, ShieldSync Security",
    duties: [],
    grossMonthly: 15000,
    annualCTC: 0,
    structure: { basic: 0, hra: 0, conveyance: 0, special: 0, gross: 15000 },
    internshipMonths: 3,
    // Stated as a RANGE and kept out of grossMonthly — the letter shows it as a
    // discretionary incentive, so the company commits only to the fixed stipend.
    variableMin: 3000,
    variableMax: 5000,
    paymentMode: "Bank Transfer",
    uanPf: "Not Applicable",
    status: "active",
  } as unknown as Employee;

  const offer = buildInternshipOffer(sample, {
    ref: "SSS/INT/2026/SAMPLE",
    date: "25 July 2026",
    mentor: "Founder, ShieldSync Security",
    scopeBullets: [
      "Managing the founder's calendar, scheduling, and meeting coordination.",
      "Drafting and managing correspondence on the founder's behalf.",
      "Travel booking, itinerary planning, and expense record-keeping.",
      "Maintaining company documents, records, and filing with strict confidentiality.",
      "Supporting day-to-day office administration and vendor coordination.",
    ],
  });

  return <InternshipOfferDoc offer={offer} toolbar={<PrintButton />} />;
}
