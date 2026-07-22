// Internship offer letter — reproduces the company's issued internship offer
// (ShieldSync_Internship_Offer_Princy_Sharon.docx): its own SSS/INT/<year>/NNN
// ref series, the internship-program tagline, a details table, and four
// sections (Details / Scope / Confidentiality-IP-Conduct / General Terms) with
// an intern acceptance block. Distinct from the full-time appointment letter —
// no probation/notice/PF machinery.

import { COMPANY, DEFAULT_SIGNATORY } from "../company";
import type { Employee } from "../employee";

export const INTERNSHIP_TAGLINE = "Secure the cloud. Build the talent that defends it.";

export type InternshipOffer = {
  ref: string; // SSS/INT/2026/001
  date: string;
  addressee: { name: string; address?: string };
  intro: string;
  detailRows: Array<{ label: string; value: string }>;
  sections: Array<{
    n: number;
    heading: string;
    intro?: string;
    bullets?: string[]; // items may carry a "Label: text" prefix (bolded up to the first colon)
  }>;
  closing: string;
  signatory: { name: string; designation: string };
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");

export function internshipRef(year: number, seq: number): string {
  return `SSS/INT/${year}/${String(seq).padStart(3, "0")}`;
}

export function buildInternshipOffer(
  e: Employee,
  opts: { ref: string; date: string; startDate?: string; mentor?: string; scopeBullets?: string[] },
): InternshipOffer {
  const months = e.internshipMonths ?? 2;
  const stipend =
    e.grossMonthly > 0
      ? `INR ${fmt(e.grossMonthly)} per month`
      : "This is an unpaid internship (no stipend payable)";

  const scope =
    opts.scopeBullets && opts.scopeBullets.length > 0
      ? opts.scopeBullets
      : e.duties.length > 0
        ? e.duties
        : [
            "Auditing and hardening AWS cloud environments — IAM, S3, encryption, and logging — the way working security teams do.",
            "Practising in managed, production-like cyber-range labs rather than passive coursework.",
            "Gaining exposure to detection and response workflows across SIEM and SOAR to understand the blue-team picture end to end.",
            "Documenting findings, fixes, and verification steps, and presenting your work to your mentor.",
            "Completing assigned learning milestones and project deliverables within the internship timeline.",
          ];

  return {
    ref: opts.ref,
    date: opts.date,
    addressee: { name: e.name, address: e.address || undefined },
    intro: `Congratulations! We are pleased to offer you an internship with ${COMPANY.legalName} ("the Company", "${COMPANY.shortName}"). We were impressed by your interest and potential in cybersecurity, and we are excited to have you join our team. The details of your internship are set out below.`,
    detailRows: [
      { label: "Position", value: e.designation },
      { label: "Duration", value: `${months} month${months === 1 ? "" : "s"}` },
      { label: "Start Date", value: opts.startDate || e.dateOfJoining },
      { label: "Engagement Type", value: e.employmentType || "Full-time internship · Remote-first" },
      { label: "Reporting To", value: opts.mentor || "Program Mentor, ShieldSync Security" },
      { label: "Stipend", value: stipend },
      { label: "Certificate", value: "Certificate of completion issued on successful completion" },
      { label: "Location", value: e.baseLocation || "Remote / Noida, Uttar Pradesh, India" },
    ],
    sections: [
      {
        n: 2,
        heading: "Scope of Work",
        intro:
          "During your internship, you will gain hands-on exposure to real cloud and security work, mentored by practising security engineers. Your responsibilities will include:",
        bullets: scope,
      },
      {
        n: 3,
        heading: "Confidentiality, IP & Conduct",
        intro: `As a security organisation, ${COMPANY.shortName} handles sensitive systems, client data, and proprietary tooling. By accepting this internship, you agree to the following:`,
        bullets: [
          "Confidentiality: You will keep strictly confidential all non-public information you access during the internship — including client data, credentials, lab environments, source code, security findings, methodologies, and business information — and will not disclose, copy, or use it for any purpose other than your assigned work, both during and after the internship.",
          `Intellectual Property: All work product, code, documentation, reports, and materials you create in the course of the internship are the sole and exclusive property of ${COMPANY.legalName}. You hereby assign all rights, title, and interest in such work product to the Company.`,
          "Data & Systems: You will access only the systems, accounts, and data expressly authorised for your tasks, and will follow all Company security policies and lawful, ethical handling of any environment you are given access to.",
          "Responsible Conduct: You will not perform any security testing or access against systems outside the authorised lab or project scope. Any unauthorised activity is strictly prohibited.",
          "Return of Materials: On completion or earlier termination, you will return or securely destroy all Company materials, credentials, and data in your possession.",
        ],
      },
      {
        n: 4,
        heading: "General Terms",
        bullets: [
          "This internship is for learning and skill-building; it does not constitute an offer of employment, and creates no obligation on either party to enter into an employment relationship.",
          "Either party may terminate this internship with prior written notice of seven (7) days. The Company may terminate immediately for breach of confidentiality, misconduct, or violation of the terms above.",
          "Successful completion is subject to satisfactory performance, attendance, and completion of assigned deliverables.",
          `This letter is governed by the laws of ${COMPANY.governingLaw}, with jurisdiction in the courts of ${COMPANY.jurisdiction}.`,
        ],
      },
    ],
    closing:
      "We look forward to your contributions and to supporting your growth into a job-ready security professional. To accept this offer, please sign and return a copy of this letter.",
    signatory: DEFAULT_SIGNATORY,
  };
}
