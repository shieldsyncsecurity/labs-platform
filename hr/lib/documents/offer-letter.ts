// Offer / Appointment Letter model. Reproduces the company's signed
// "LETTER OF APPOINTMENT" (Projects\ShieldSync Documents\Diya Visa\Final\
// ShieldSync - Offer Letter.pdf) section-for-section, as a STRUCTURED model the
// letterhead view renders to HTML (tables + bullets) and to PDF. Boilerplate is
// verbatim; only the parameterized values (names, dates, comp, probation/notice
// periods) and three additive upgrades vary.
//
// Upgrades (all opt-in; the letter matches the signed original when they are
// omitted): `acceptBy` renders a validity/accept-by line; `retentionMonths`
// adds a retention period to the Data Protection clause; the seal is applied by
// the view when `seal` is true.

import { COMPANY, DEFAULT_SIGNATORY } from "../company";
import { rupeesToWords, type SalaryStructure } from "../payslip";

export type OfferEmployee = {
  name: string;
  address: string;
  designation: string;
  department: string;
  dateOfJoining: string; // display, e.g. "2 March 2026"
  employmentType?: string; // default "Full-time, permanent"
  annualCTC: number; // e.g. 360000
  grossMonthly: number; // e.g. 30000
  baseLocation?: string; // default matches signed letter
  reportingTo?: string; // default matches signed letter
};

export type OfferLetterInput = {
  ref: string; // SSS/HR/2026/003
  date: string; // "27 Feb 2026"
  employee: OfferEmployee;
  /** Role-specific responsibility bullets (Section 2). */
  duties: string[];
  /** Annexure A monthly structure (defaults suggested from grossMonthly upstream). */
  structure: SalaryStructure;
  probationMonths?: number; // default 3
  probationNoticeDays?: number; // default 15
  postConfirmationNoticeDays?: number; // default 30
  nonSolicitMonths?: number; // default 12
  signatory?: { name: string; designation: string };
  // --- optional upgrades ---
  acceptBy?: string; // e.g. "10 March 2026"
  retentionMonths?: number; // e.g. 36 -> adds retention line to Data Protection
  seal?: boolean; // view applies the company seal near the signatory block
};

export type OfferSection = {
  n: number;
  heading: string;
  /** Ordered blocks: plain paragraphs and/or bullet lists. */
  blocks: Array<{ type: "p"; text: string } | { type: "ul"; items: string[] }>;
};

export type OfferLetter = {
  title: string;
  ref: string;
  date: string;
  confidential: string;
  addressee: { name: string; address: string };
  intro: string;
  positionRows: Array<{ label: string; value: string }>;
  sections: OfferSection[];
  annexure: {
    heading: string;
    subheading: string;
    rows: Array<{ component: string; monthly: number; annual: number }>;
    grossRow: { monthly: number; annual: number };
    notes: string[];
  };
  signatory: { name: string; designation: string };
  seal: boolean;
  acceptBy?: string;
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

/** "INR 3,60,000 (Rupees Three Lakh Sixty Thousand only) per <unit>" — signed-letter style. */
function moneyLong(amount: number, unit: string): string {
  return `INR ${fmt(amount)} (Rupees ${rupeesToWords(Math.floor(amount))} only) per ${unit}`;
}

export function buildOfferLetter(input: OfferLetterInput): OfferLetter {
  const e = input.employee;
  const probationMonths = input.probationMonths ?? 3;
  const probationNotice = input.probationNoticeDays ?? 15;
  const postNotice = input.postConfirmationNoticeDays ?? 30;
  const nonSolicit = input.nonSolicitMonths ?? 12;
  const employmentType = e.employmentType ?? "Full-time, permanent";
  const baseLocation = e.baseLocation ?? "Noida, Uttar Pradesh, India (Remote-first)";
  const reportingTo = e.reportingTo ?? "Founder / Reporting Manager, ShieldSync Security";
  const signatory = input.signatory ?? DEFAULT_SIGNATORY;

  const positionRows = [
    { label: "Employee Name", value: e.name },
    { label: "Designation", value: e.designation },
    { label: "Department / Function", value: e.department },
    { label: "Date of Joining", value: e.dateOfJoining },
    { label: "Employment Type", value: employmentType },
    { label: "Annual CTC", value: moneyLong(e.annualCTC, "annum") },
    { label: "Gross Monthly", value: moneyLong(e.grossMonthly, "month") },
    { label: "Base Work Location", value: baseLocation },
    { label: "Reporting To", value: reportingTo },
  ];

  const dataProtectionBlocks: OfferSection["blocks"] = [
    {
      type: "p",
      text:
        "You will handle all personal and client data in compliance with applicable data-protection laws (including the DPDP Act and, where relevant, GDPR) and the Company's data-protection policies. You consent to the Company processing your personal data for employment, payroll, statutory, and administrative purposes.",
    },
  ];
  if (input.retentionMonths && input.retentionMonths > 0) {
    dataProtectionBlocks.push({
      type: "p",
      text: `Your employment records and personal data are retained for the duration of your employment and for ${input.retentionMonths} months thereafter (or longer where a statutory or legal-hold requirement applies), after which they are securely deleted or irreversibly anonymised.`,
    });
  }

  const sections: OfferSection[] = [
    {
      n: 2,
      heading: "Duties & Responsibilities",
      blocks: [
        {
          type: "p",
          text:
            "You will diligently perform the duties of your role and such other duties consistent with your position as the Company may reasonably assign from time to time. Your responsibilities include:",
        },
        { type: "ul", items: input.duties },
      ],
    },
    {
      n: 3,
      heading: "Compensation & Benefits",
      blocks: [
        {
          type: "p",
          text: `Your gross remuneration is ${moneyLong(e.grossMonthly, "month")} (Annual CTC INR ${fmt(e.annualCTC)}), payable monthly in arrears by the agreed pay date, subject to applicable statutory deductions including, where applicable, Provident Fund, Professional Tax, and Tax Deducted at Source (TDS). The detailed salary structure is set out in Annexure A.`,
        },
        {
          type: "p",
          text:
            "Your compensation is personal to you and strictly confidential. Statutory benefits (such as Provident Fund, ESI, and Gratuity) will apply in accordance with applicable law and the Company's eligibility thresholds. Compensation is reviewed periodically at the Company's sole discretion based on individual performance and business considerations.",
        },
      ],
    },
    {
      n: 4,
      heading: "Probation & Confirmation",
      blocks: [
        {
          type: "p",
          text: `Your employment is subject to a probation period of ${probationMonths} months from your date of joining. The Company may extend the probation at its discretion. On satisfactory completion, your employment will be confirmed in writing. Until confirmation, either party may terminate the employment by giving ${probationNotice} days' written notice.`,
        },
      ],
    },
    {
      n: 5,
      heading: "Hours of Work, Place of Work & Mobility",
      blocks: [
        {
          type: "p",
          text:
            "Normal working days are Monday to Friday, with hours as per Company policy; the nature of security work may require availability beyond standard hours, including on-call or incident response, for which no separate overtime is payable. Your base location is as stated above; the Company may, by reasonable notice, require you to work from or be transferred to any of its offices, client sites, or locations, or to work remotely, as business needs require.",
        },
      ],
    },
    {
      n: 6,
      heading: "Performance Review",
      blocks: [
        {
          type: "p",
          text:
            "Your performance will be reviewed periodically against agreed objectives and the Company's performance framework. Continued employment, confirmation, and any revision in compensation are subject to satisfactory performance and conduct.",
        },
      ],
    },
    {
      n: 7,
      heading: "Leave & Holidays",
      blocks: [
        {
          type: "p",
          text:
            "You will be entitled to leave and public holidays in accordance with the Company's leave policy as amended from time to time. Leave must be applied for and approved in advance, save in cases of genuine emergency.",
        },
      ],
    },
    {
      n: 8,
      heading: "Background Verification & Accuracy of Information",
      blocks: [
        {
          type: "p",
          text:
            "This appointment is subject to verification of your credentials, identity, and prior experience. You confirm that all information and documents furnished by you are true, complete, and accurate. Any misrepresentation or suppression of material facts may result in withdrawal of this offer or termination of employment without notice or compensation.",
        },
      ],
    },
    {
      n: 9,
      heading: "Code of Conduct & Information Security",
      blocks: [
        {
          type: "p",
          text:
            "You will comply with the Company's Code of Conduct, Acceptable Use, and Information Security policies, and with all applicable laws and client security requirements. You will:",
        },
        {
          type: "ul",
          items: [
            "Access only the systems, accounts, and data authorised for your role, and perform security testing strictly within authorised scope and rules of engagement.",
            "Follow secure-handling, least-privilege, and data-protection practices for all client and Company environments.",
            "Promptly report any actual or suspected security incident, vulnerability, or policy breach through the designated channel.",
          ],
        },
      ],
    },
    {
      n: 10,
      heading: "Confidentiality",
      blocks: [
        {
          type: "p",
          text:
            "During and after your employment, you will keep strictly confidential all non-public information of the Company and its clients — including client data, credentials, security findings, methodologies, source code, lab environments, pricing, and business information (“Confidential Information”) — and will not disclose, copy, or use it other than for the proper performance of your duties. These obligations survive the termination of your employment.",
        },
      ],
    },
    {
      n: 11,
      heading: "Intellectual Property & Inventions",
      blocks: [
        {
          type: "p",
          text:
            "All work product, software, code, documentation, reports, designs, lab content, and inventions created by you in the course of your employment or using Company resources (“Work Product”) are the sole and exclusive property of ShieldSync Security Private Limited. You hereby irrevocably assign to the Company all rights, title, and interest, including all intellectual property rights, in such Work Product, and will execute any documents reasonably required to perfect such assignment.",
        },
      ],
    },
    {
      n: 12,
      heading: "Non-Solicitation, Conflict of Interest & Exclusivity",
      blocks: [
        {
          type: "ul",
          items: [
            `During your employment and for ${nonSolicit} months thereafter, you will not solicit or entice away any client, employee, or contractor of the Company for any competing purpose.`,
            "You will devote your full working time to the Company and will not, without prior written consent, engage in any other employment, business, or activity that conflicts with your duties or the Company's interests.",
            "You will promptly disclose any actual or potential conflict of interest.",
          ],
        },
      ],
    },
    {
      n: 13,
      heading: "Data Protection",
      blocks: dataProtectionBlocks,
    },
    {
      n: 14,
      heading: "Termination & Notice Period",
      blocks: [
        {
          type: "ul",
          items: [
            `After confirmation, either party may terminate this employment by giving ${postNotice} days' written notice, or salary in lieu thereof, subject to Company policy.`,
            "The Company may terminate your employment forthwith, without notice or compensation, for misconduct, breach of confidentiality or information-security obligations, unsatisfactory performance during probation, or breach of the terms of this letter.",
            "The Company may, at its discretion, place you on garden leave during any notice period.",
            "On separation, you will return all Company and client property, materials, credentials, devices, and data, and will continue to honour your confidentiality, IP, and non-solicitation obligations.",
          ],
        },
      ],
    },
    {
      n: 15,
      heading: "General Terms",
      blocks: [
        {
          type: "ul",
          items: [
            "Retirement age and statutory entitlements apply as per Company policy and applicable law.",
            "This letter, its Annexure, and Company policies (as amended from time to time) constitute the entire agreement between the parties and supersede all prior understandings, whether oral or written.",
            "No amendment to these terms is valid unless made in writing and signed by an authorised signatory of the Company.",
            "If any provision is held invalid or unenforceable, the remaining provisions continue in full force and effect.",
            `This appointment is governed by the laws of ${COMPANY.governingLaw}. The courts at ${COMPANY.jurisdiction} shall have exclusive jurisdiction, subject to amicable resolution of disputes in the first instance.`,
          ],
        },
      ],
    },
  ];

  const annexure = {
    heading: "ANNEXURE A — COMPENSATION STRUCTURE",
    subheading: `Employee: ${e.name}  |  Designation: ${e.designation}  |  Effective: ${e.dateOfJoining}`,
    rows: [
      { component: "Basic Pay", monthly: input.structure.basic, annual: input.structure.basic * 12 },
      { component: "House Rent Allowance (HRA)", monthly: input.structure.hra, annual: input.structure.hra * 12 },
      { component: "Conveyance Allowance", monthly: input.structure.conveyance, annual: input.structure.conveyance * 12 },
      { component: "Special Allowance", monthly: input.structure.special, annual: input.structure.special * 12 },
    ],
    grossRow: { monthly: input.structure.gross, annual: input.structure.gross * 12 },
    notes: [
      `Figures above are indicative and may be restructured to comply with statutory requirements; the gross Cost to Company remains INR ${fmt(e.grossMonthly)} per month.`,
      "Net (take-home) pay is gross salary less applicable statutory deductions (Provident Fund, Professional Tax, and TDS) as per prevailing law.",
      "Statutory benefits (PF, ESI, Gratuity) apply per applicable eligibility and law. This Annexure forms an integral part of the Letter of Appointment.",
    ],
  };

  const intro = `With reference to your association with us, we are pleased to formally appoint you to the position of ${e.designation} at ${COMPANY.legalName} (“the Company” / “${COMPANY.shortName}”), with effect from your date of joining, ${e.dateOfJoining}. This letter, together with its Annexure and the Company's policies, sets out the terms and conditions of your employment.`;

  return {
    title: "LETTER OF APPOINTMENT",
    ref: input.ref,
    date: input.date,
    confidential: "Private & Confidential",
    addressee: { name: e.name, address: e.address },
    intro,
    positionRows,
    sections,
    annexure,
    signatory,
    seal: input.seal ?? true, // pre-signed (signature + seal) by default
    acceptBy: input.acceptBy,
  };
}
