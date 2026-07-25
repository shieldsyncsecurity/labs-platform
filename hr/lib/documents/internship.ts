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

/**
 * Scope bullets when the employee record carries no duties.
 *
 * This used to be a single hardcoded cloud-security list, which meant an
 * Executive Assistant's offer letter described auditing AWS IAM policies —
 * plausible-looking text in the right shape, and completely wrong. Silently
 * substituting confident-sounding content is worse than substituting nothing,
 * because nobody proofreads a section that looks finished.
 *
 * So: match on designation where we can, and where we can't, emit something
 * that CANNOT be mistaken for finished copy.
 */
function defaultScopeFor(designation: string): string[] {
  const d = (designation ?? "").toLowerCase();

  if (/assistant|secretary|administrat|operations|office/.test(d)) {
    return [
      "Managing the founder's calendar — scheduling and rescheduling, resolving clashes, protecting focused working time, and making sure the day is realistic.",
      "Triaging the inbox: prioritising what needs attention, drafting replies for review, and making sure nothing important goes unanswered.",
      "Coordinating meetings end to end — agendas beforehand, notes during, and chasing the resulting actions to completion.",
      "Arranging travel, appointments, and logistics, and keeping the founder briefed on what is coming up.",
      "Keeping company records, trackers, and documents organised, accurate, and easy to retrieve.",
      "Acting as a first point of contact for clients, vendors, and candidates, handling correspondence professionally on the company's behalf.",
      "Preparing background and briefing notes ahead of meetings so the founder walks in prepared.",
      "Handling confidential company, client, and personnel information with discretion at all times.",
      "Learning how a cybersecurity business runs day to day — client engagements, compliance obligations, and internal operations — and taking on more as you grow into the role.",
    ];
  }

  if (/security|cloud|soc|analyst|engineer|grc|compliance/.test(d)) {
    return [
      "Auditing and hardening cloud environments — IAM, storage, encryption, and logging — the way working security teams do.",
      "Practising in managed, production-like cyber-range labs rather than passive coursework.",
      "Gaining exposure to detection and response workflows across SIEM and SOAR to understand the blue-team picture end to end.",
      "Documenting findings, fixes, and verification steps, and presenting your work to your mentor.",
      "Completing assigned learning milestones and project deliverables within the internship timeline.",
    ];
  }

  // Deliberately not plausible prose. If this reaches a letter, it is meant to
  // stop the person issuing it, not slip past them.
  return [
    "[ SCOPE OF WORK NOT SET — add this intern's duties to their employee record before issuing this letter. ]",
  ];
}

export function buildInternshipOffer(
  e: Employee,
  opts: { ref: string; date: string; startDate?: string; mentor?: string; scopeBullets?: string[] },
): InternshipOffer {
  const months = e.internshipMonths ?? 2;
  // The FIXED stipend and any performance incentive are stated separately on
  // purpose. Rolling them into one figure would commit the company to paying
  // the incentive as guaranteed pay — the intern could reasonably hold us to
  // the combined number, which defeats the point of making it performance-linked.
  const stipend =
    e.grossMonthly > 0
      ? `INR ${fmt(e.grossMonthly)} per month (fixed)`
      : "This is an unpaid internship (no stipend payable)";
  const incentive =
    e.variableMin && e.variableMax
      ? `INR ${fmt(e.variableMin)} – ${fmt(e.variableMax)} per month, performance-linked and at the Company's discretion`
      : e.variableMax
        ? `Up to INR ${fmt(e.variableMax)} per month, performance-linked and at the Company's discretion`
        : null;

  const scope =
    opts.scopeBullets && opts.scopeBullets.length > 0
      ? opts.scopeBullets
      : e.duties.length > 0
        ? e.duties
        : defaultScopeFor(e.designation);

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
      ...(incentive ? [{ label: "Performance Incentive", value: incentive }] : []),
      { label: "Certificate", value: "Certificate of completion issued on successful completion" },
      { label: "Location", value: e.baseLocation || "Remote / Noida, Uttar Pradesh, India" },
    ],
    sections: [
      {
        n: 2,
        heading: "Nature of This Engagement",
        intro:
          "So that there is no ambiguity later, both parties record their understanding of what this engagement is and is not:",
        bullets: [
          "Internship, not employment: This is a fixed-term internship for learning and practical experience. It does not create an employer-employee relationship, does not constitute an offer of employment, and places no obligation on either party to enter into one at the end of the term.",
          "Stipend, not wages: The amounts set out above are a stipend paid in support of your internship. They are not wages or salary, and are not consideration for an employment contract.",
          "Statutory benefits: As this is not employment, you will not accrue provident fund, gratuity, employee state insurance, leave encashment, notice pay, severance, or other benefits available to employees. Any statutory deduction that does become applicable by law will be made and remitted accordingly.",
          "No authority to bind: You may not enter into contracts, make commitments, incur expenditure, or hold yourself out as authorised to act on behalf of the Company, except as expressly instructed in writing.",
        ],
      },
      {
        n: 3,
        heading: "Scope of Work & Learning",
        intro:
          "You will be given real, substantive work with guidance and review, rather than observation alone. Your responsibilities will include:",
        // A specific scope list without a catch-all is worse than a vague one:
        // it reads as exhaustive, so anything sensible but unlisted becomes a
        // negotiation. This is the standard clause that makes a detailed scope
        // safe to write. "Commensurate with your role" is the limit — it covers
        // adjacent company work, not personal errands.
        bullets: [
          ...scope,
          "Such other duties as may reasonably be assigned from time to time, commensurate with your role and experience.",
        ],
      },
      {
        n: 4,
        heading: "Working Arrangements",
        bullets: [
          "Working days are Monday to Friday. Your working hours are 12:00 noon to 8:00 PM, and you are expected to be available from 11:30 AM to settle in and pick up anything outstanding before the day begins.",
          // A rest interval is not optional decoration: the UP Shops and
          // Commercial Establishments Act requires a break within a continuous
          // working stretch of this length, and a letter that schedules eight
          // straight hours without one is inconsistent with it on its face.
          "You are entitled to a rest and meal break of at least thirty (30) minutes during the working day, to be taken at a time that suits the day's commitments.",
          "There will be flexibility on both sides where the work genuinely requires it. You will not be required to work on public holidays.",
          "The stipend is paid monthly in arrears, by bank transfer, ordinarily within the first ten (10) working days of the following month.",
          "Any performance incentive is assessed at the end of each month, is at the sole discretion of the Company, and is neither guaranteed nor an entitlement. A month in which no incentive is paid is not a breach of this letter.",
          "You are entitled to one (1) day of paid leave per completed month of the internship, to be taken with prior approval. Leave does not carry forward beyond the term and is not encashable.",
          "You will inform the Company as early as practicable if you are unable to attend on a working day.",
        ],
      },
      {
        n: 5,
        heading: "Confidentiality & Data Protection",
        intro: `As a security organisation, ${COMPANY.shortName} handles sensitive systems, client data, employee records, and proprietary tooling. By accepting this internship you agree that:`,
        bullets: [
          "You will keep strictly confidential all non-public information you access — including client data, credentials, lab environments, source code, security findings, methodologies, commercial terms, employee and candidate records, and business information — and will not disclose, copy, transmit, or use it for any purpose other than your assigned work.",
          "These confidentiality obligations continue during the internship and remain in force after it ends, without limit of time for anything that constitutes a trade secret, and for three (3) years from the end of the term for all other confidential information.",
          "Where you handle personal data belonging to any individual, you will process it only as instructed by the Company and in accordance with the Digital Personal Data Protection Act, 2023. You will not retain personal data after the term ends, and you will report any suspected data breach or accidental disclosure to the Company immediately.",
          "You will not make any public statement, social media post, or other disclosure that identifies the Company's clients, engagements, findings, or internal matters, at any time.",
          "Confidential information does not include information that is or becomes public through no act of yours, or that you are required to disclose by law or a competent authority — in which case you will notify the Company in advance where lawfully permitted.",
        ],
      },
      {
        n: 6,
        heading: "Intellectual Property",
        bullets: [
          `All work product, code, documentation, reports, designs, materials, and other output you create in the course of or in connection with this internship is the sole and exclusive property of ${COMPANY.legalName}.`,
          "You hereby irrevocably assign to the Company all present and future rights, title, and interest in such work product, including copyright, worldwide and for the full term of those rights, and you waive any moral rights in it to the extent permitted by law.",
          "You will, at the Company's request and cost, sign any further document reasonably required to give effect to this assignment.",
          "If you incorporate anything you owned before this internship, or any third-party or open-source material, into your work product, you will identify it to the Company in advance and ensure the Company has the rights it needs to use it.",
        ],
      },
      {
        n: 7,
        heading: "Systems Access & Conduct",
        bullets: [
          "You will access only the systems, accounts, mailboxes, and records you have been given access to for your own work, using the credentials issued to you, and you will not share those credentials with anyone.",
          "You will not attempt to reach any system, account, or file you have not been given access to, and you will not copy Company or client data to any personal account, device, or storage service. Doing so is a serious breach of this letter and may also be an offence under the Information Technology Act, 2000.",
          "You will follow the Company's security instructions on device security, password management, and handling Company data on any personal device — these apply to everyone here, whatever their role.",
          "You will conduct yourself professionally and respectfully in all dealings with colleagues, clients, and third parties, and will comply with all applicable laws in the course of your work.",
        ],
      },
      {
        n: 8,
        heading: "Conflict of Interest & Non-Solicitation",
        bullets: [
          "During the term you will not take up any engagement, employment, or activity that conflicts with your duties here or with the Company's interests, and you will disclose any potential conflict as soon as you become aware of it.",
          "For twelve (12) months after the term ends, you will not approach any client, prospective client, employee, or intern of the Company you dealt with during the internship in order to take their business away from the Company or persuade them to leave it.",
          "You are free to take any job you like after this internship ends. This clause is only about not taking the Company's clients or people with you — it does not stop you working anywhere, in any role or industry.",
        ],
      },
      {
        n: 9,
        heading: "Company Property & Return of Materials",
        bullets: [
          "Any equipment, devices, accounts, access cards, or materials issued to you remain the property of the Company, are to be used for Company purposes, and are to be kept secure and in good condition.",
          "On completion or earlier termination, and in any event on request, you will promptly return all Company property and return or securely destroy all Company materials, credentials, and data in your possession or control, in any format, and confirm in writing that you have done so.",
        ],
      },
      {
        n: 10,
        heading: "Term, Termination & Certificate",
        bullets: [
          "This internship runs for the term stated above unless ended earlier in accordance with this section. It ends automatically on the end date without further notice, and does not renew unless agreed in writing.",
          "Either party may end the internship earlier by giving seven (7) days' prior written notice.",
          "The Company may end it immediately, without notice, for breach of confidentiality or data protection obligations, unauthorised access or security testing, serious misconduct, dishonesty, or material breach of any term of this letter.",
          "A Certificate of Completion will be issued on satisfactory completion of the full term, subject to performance, attendance, and completion of assigned deliverables. It is not issued where the internship ends early for cause.",
          "The sections on Confidentiality & Data Protection, Intellectual Property, Conflict of Interest & Non-Solicitation, and Company Property survive the end of this engagement.",
        ],
      },
      {
        n: 11,
        heading: "General",
        bullets: [
          "This offer is made on the basis of the information you have provided, and is conditional on that information being accurate and on verification of your identity, education, and any prior engagement, together with your submission of the documents the Company reasonably requests.",
          "This letter, together with any policies the Company notifies to you, is the entire agreement between us on this engagement and supersedes any earlier discussion, representation, or understanding, whether written or verbal.",
          "Any variation to these terms must be agreed in writing and signed by both parties.",
          "If any provision of this letter is found to be unenforceable, the remainder continues in full force, and that provision will apply with the minimum modification necessary to make it enforceable.",
          "A failure or delay by the Company in enforcing any term is not a waiver of that term or of any other.",
          `This letter is governed by the laws of ${COMPANY.governingLaw}, and the courts of ${COMPANY.jurisdiction} have exclusive jurisdiction over any dispute arising from it.`,
        ],
      },
    ],
    closing:
      "We look forward to your contributions and to supporting your growth into a job-ready professional. Please read this letter in full — it sets out the whole of what has been agreed. If anything is unclear or does not match your understanding, raise it before signing rather than after. To accept, please sign and return a copy.",
    signatory: DEFAULT_SIGNATORY,
  };
}
