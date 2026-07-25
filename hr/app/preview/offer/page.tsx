import { buildOfferLetter } from "@/lib/documents/offer-letter";
import { suggestStructure } from "@/lib/payslip";
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Offer letter preview", robots: { index: false, follow: false } };

// Dev/verify page: renders the real component + module so the letter format can
// be eyeballed without opening a real employee record.
//
// SAMPLE DATA ONLY — deliberately fictional. This page is reachable from the
// dashboard, so putting a real employee's name, home address and salary here
// would expose their personal data to anyone browsing the portal. Keep it
// fictional. suggestStructure(30000) still exercises the real 50/40/1600/balance
// split logic (15,000 / 6,000 / 1,600 / 7,400).
export default function OfferPreview() {
  const structure = suggestStructure(30000);
  const letter = buildOfferLetter({
    ref: "SSS/HR/2026/SAMPLE",
    date: "27 Feb 2026",
    employee: {
      name: "Aarav Sample",
      address: "12, Sample Residency, Sector 62, Noida, Uttar Pradesh 201309",
      designation: "GRC Analyst",
      department: "Governance, Risk & Compliance (GRC)",
      dateOfJoining: "2 March 2026",
      annualCTC: 360000,
      grossMonthly: 30000,
    },
    duties: [
      "Supporting client GRC engagements and audit readiness across SOC 2, ISO 27001, GDPR, PCI DSS, and the DPDP Act.",
      "Conducting risk assessments, gap analyses, and control mapping against applicable security and privacy frameworks.",
      "Developing and maintaining information security policies, standards, and procedures.",
      "Collecting and reviewing audit evidence, tracking remediation actions, and supporting internal and external audits.",
      "Assisting with third-party and vendor risk assessments and preparing client compliance and reporting documentation.",
    ],
    structure,
  });

  return <OfferLetterDoc letter={letter} toolbar={<PrintButton />} />;
}
