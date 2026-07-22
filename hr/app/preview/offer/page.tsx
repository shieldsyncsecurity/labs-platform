import { buildOfferLetter } from "@/lib/documents/offer-letter";
import { suggestStructure } from "@/lib/payslip";
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Offer letter preview", robots: { index: false, follow: false } };

// Dev/verify page: the owner's finalized Diya appointment letter rendered through
// the real component + module. suggestStructure(30000) reproduces her Annexure A
// (15,000 / 6,000 / 1,600 / 7,400).
export default function OfferPreview() {
  const structure = suggestStructure(30000);
  const letter = buildOfferLetter({
    ref: "SSS/HR/2026/002",
    date: "27 Feb 2026",
    employee: {
      name: "Diya Jain",
      address: "007, Tower 2, JM Park Saffire, Ramprastha Greens, Vaishali, Ghaziabad, U.P. 201010",
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
