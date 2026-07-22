// Short single-page HR letters (employment verification, experience/relieving)
// as a shared structured model rendered by components/SimpleLetterDoc. Same
// letterhead + pre-signed signatory block as the appointment letter.

import { COMPANY, DEFAULT_SIGNATORY } from "../company";
import { rupeesToWords } from "../payslip";
import type { Employee } from "../employee";

export type LetterTable =
  | { kind: "kv"; rows: [string, string][] } // label/value rows (leave letter)
  | { kind: "grid"; headers: string[]; rows: string[][] }; // n-column (increment)

export type SimpleLetter = {
  runLabel: string; // running-header right label
  title: string; // main title ("" = subject-only letters like the leave NOC)
  ref: string;
  date: string;
  to?: { name?: string; lines?: string[] }; // addressee block (optional)
  /** Italic note under the addressee, e.g. "(Addressed to the Visa Officer …)". */
  toNote?: string;
  /** Underlined centred SUBJECT line (the signed leave letter's style). */
  subject?: string;
  salutation?: string;
  paragraphs: string[];
  /** Optional table between paragraphs and paragraphs2. */
  table?: LetterTable;
  /** Paragraphs rendered after the table. */
  paragraphs2?: string[];
  /**
   * Sign-off style: "signed" = pre-signed signatory block (default; matches the
   * appointment letter). "hr-dept" = the signed leave letter's style — "Yours
   * faithfully / For <company> / Human Resources Department" + the
   * computer-generated-validity note, NO signature image.
   */
  signoff?: "signed" | "hr-dept";
  signatory: { name: string; designation: string };
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString("en-IN");
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Employment verification letter — certifies role, tenure, and (optionally) CTC. */
export function buildVerificationLetter(
  e: Employee,
  opts: { ref: string; date: string; purpose?: string; to?: { name?: string; lines?: string[] }; includeSalary?: boolean },
): SimpleLetter {
  const first = firstName(e.name);
  const exited = e.status === "exited" && !!e.lastWorkingDay;
  const tenure = exited ? `from ${e.dateOfJoining} to ${e.lastWorkingDay}` : `since ${e.dateOfJoining}`;
  const verb = exited ? "was employed" : "is employed";

  const paragraphs: string[] = [
    `This is to certify that ${e.name} (Employee ID: ${e.employeeId}) ${verb} with ${COMPANY.legalName} as ${e.designation}${e.department ? ` in the ${e.department} department` : ""}, ${tenure}.`,
    exited
      ? `${first} was engaged on a ${e.employmentType.toLowerCase()} basis${e.baseLocation ? `, based at ${e.baseLocation}` : ""}.`
      : `${first} is engaged on a ${e.employmentType.toLowerCase()} basis${e.baseLocation ? `, based at ${e.baseLocation}` : ""}, and as of the date of this letter continues to be in the active employment of the Company.`,
  ];
  if (opts.includeSalary !== false) {
    paragraphs.push(
      `The ${exited ? "last drawn" : "current"} annual cost to company (CTC) is INR ${fmt(e.annualCTC)} (Rupees ${rupeesToWords(Math.floor(e.annualCTC))} only) per annum.`,
    );
  }
  paragraphs.push(
    opts.purpose
      ? `This letter is issued at ${first}'s request for the purpose of ${opts.purpose}.`
      : `This letter is issued at ${first}'s request for whatever purpose it may serve.`,
    `For any verification, please contact the undersigned at ${COMPANY.hrEmail}.`,
  );

  const to = opts.to ?? { name: "To Whom It May Concern" };
  return {
    runLabel: "Employment Verification",
    title: "EMPLOYMENT VERIFICATION LETTER",
    ref: opts.ref,
    date: opts.date,
    to,
    salutation: to.name && to.name !== "To Whom It May Concern" ? "Dear Sir/Madam," : undefined,
    paragraphs,
    signatory: DEFAULT_SIGNATORY,
  };
}

/**
 * Leave approval / NOC letter — reproduces the signed original
 * (ShieldSync_Leave_Approval_Diya_Jain.pdf, Ref SSS/HR/2026/014): SUBJECT line,
 * 5-row leave table, no-objection + return-confirmation paragraphs, and the
 * "Human Resources Department" sign-off with the computer-generated-validity
 * note (no signature image on this letter type).
 */
export function buildLeaveLetter(
  e: Employee,
  opts: {
    ref: string;
    date: string;
    leaveFrom: string; // display date
    leaveTo: string; // display date
    totalDays: number;
    purpose: string;
    resumeDate: string; // display date
    paid?: boolean; // default true
    /** Italic line under the addressee, e.g. "(Addressed to the Visa Officer / Consular Authority, Schengen Member State)". */
    toNote?: string;
    /** "in support of ..." context, e.g. "her Schengen visa application". Optional. */
    supportPurpose?: string;
  },
): SimpleLetter {
  const paidLabel = opts.paid === false ? "approved unpaid leave" : "approved paid leave";
  const first = firstName(e.name);

  return {
    runLabel: "Leave Approval Letter",
    title: "",
    subject: `APPROVED LEAVE OF ABSENCE - ${e.name.toUpperCase()}`,
    ref: opts.ref,
    date: opts.date,
    to: { name: "To Whom It May Concern" },
    toNote: opts.toNote,
    paragraphs: [
      `This is to certify that ${e.name}, ${e.designation} (Employee ID: ${e.employeeId}), a ${e.employmentType.toLowerCase()} employee of ${COMPANY.legalName} since ${e.dateOfJoining}, has been granted ${paidLabel} of absence as detailed below.`,
    ],
    table: {
      kind: "kv",
      rows: [
        ["Leave From", opts.leaveFrom],
        ["Leave To", `${opts.leaveTo} (both days inclusive)`],
        ["Total Days", `${opts.totalDays} days (${paidLabel})`],
        ["Purpose", opts.purpose],
        ["Date of Resuming Duty", opts.resumeDate],
      ],
    },
    paragraphs2: [
      `The Company has no objection to ${first} travelling during the above period. The leave has been duly sanctioned, and ${first}'s position, salary, and employment with the Company remain secure throughout the absence.`,
      `We confirm that ${first} is expected to resume duties on ${opts.resumeDate}. ${first} continues to be a valued member of our team, and the employment will continue on the same terms following the authorised leave.`,
      opts.supportPurpose
        ? `This letter is issued in support of ${opts.supportPurpose}. Should you require any verification, please contact us at ${COMPANY.hrEmail} or ${COMPANY.phone}.`
        : `This letter is issued at ${first}'s request. Should you require any verification, please contact us at ${COMPANY.hrEmail} or ${COMPANY.phone}.`,
    ],
    signoff: "hr-dept",
    signatory: DEFAULT_SIGNATORY,
  };
}

/** Salary revision / increment letter — old vs revised structure + effective date. */
export function buildIncrementLetter(
  e: Employee,
  opts: {
    ref: string;
    date: string;
    effectiveDate: string;
    oldStructure: { basic: number; hra: number; conveyance: number; special: number; gross: number };
    newStructure: { basic: number; hra: number; conveyance: number; special: number; gross: number };
    newAnnualCTC: number;
    reason?: string; // e.g. "your performance and contribution"
  },
): SimpleLetter {
  const o = opts.oldStructure;
  const n = opts.newStructure;
  const money = (v: number) => fmt(v);

  return {
    runLabel: "Salary Revision Letter",
    title: "SALARY REVISION LETTER",
    ref: opts.ref,
    date: opts.date,
    to: { name: e.name },
    salutation: `Dear ${firstName(e.name)},`,
    paragraphs: [
      `We are pleased to inform you that in recognition of ${opts.reason || "your performance and contribution"}, the Company has revised your compensation with effect from ${opts.effectiveDate}. Your revised monthly salary structure is set out below.`,
    ],
    table: {
      kind: "grid",
      headers: ["Component", "Current (INR / month)", "Revised (INR / month)"],
      rows: [
        ["Basic Pay", money(o.basic), money(n.basic)],
        ["House Rent Allowance (HRA)", money(o.hra), money(n.hra)],
        ["Conveyance Allowance", money(o.conveyance), money(n.conveyance)],
        ["Special Allowance", money(o.special), money(n.special)],
        ["Gross Salary", money(o.gross), money(n.gross)],
      ],
    },
    paragraphs2: [
      `Your revised annual cost to company (CTC) is INR ${fmt(opts.newAnnualCTC)} (Rupees ${rupeesToWords(Math.floor(opts.newAnnualCTC))} only) per annum. All other terms and conditions of your employment remain unchanged.`,
      `We thank you for your continued dedication and look forward to your growing contribution to ${COMPANY.shortName}.`,
    ],
    signatory: DEFAULT_SIGNATORY,
  };
}

/** Probation confirmation letter — the written confirmation the appointment letter promises. */
export function buildConfirmationLetter(
  e: Employee,
  opts: { ref: string; date: string; confirmationDate: string },
): SimpleLetter {
  const first = firstName(e.name);
  return {
    runLabel: "Confirmation Letter",
    title: "CONFIRMATION OF EMPLOYMENT",
    ref: opts.ref,
    date: opts.date,
    to: { name: e.name },
    salutation: `Dear ${first},`,
    paragraphs: [
      `Further to the terms of your Letter of Appointment, we are pleased to confirm that you have successfully completed your probation period, and your employment with ${COMPANY.legalName} as ${e.designation} stands confirmed with effect from ${opts.confirmationDate}.`,
      `Consequent to this confirmation, the notice period applicable to your employment is as set out in your Letter of Appointment for confirmed employees. All other terms and conditions of your employment remain unchanged.`,
      `We congratulate you on your confirmation and look forward to your continued contribution.`,
    ],
    signatory: DEFAULT_SIGNATORY,
  };
}

/** Internship completion certificate — issued after an internship engagement ends. */
export function buildCompletionCertificate(
  e: Employee,
  opts: { ref: string; date: string; fromDate: string; toDate: string; project?: string },
): SimpleLetter {
  const first = firstName(e.name);
  return {
    runLabel: "Certificate of Completion",
    title: "CERTIFICATE OF COMPLETION",
    ref: opts.ref,
    date: opts.date,
    paragraphs: [
      `This is to certify that ${e.name} has successfully completed an internship with ${COMPANY.legalName} as ${e.designation} from ${opts.fromDate} to ${opts.toDate}.`,
      opts.project
        ? `During the internship, ${first} worked on ${opts.project}, and demonstrated sincerity, professionalism, and a strong aptitude for cybersecurity work.`
        : `During the internship, ${first} received hands-on exposure to real cloud and security work under the mentorship of practising security engineers, and demonstrated sincerity, professionalism, and a strong aptitude for cybersecurity work.`,
      `${first}'s performance and conduct during the internship were found to be satisfactory, and the assigned learning milestones and deliverables were completed within the internship timeline.`,
      `We wish ${first} continued success in all future endeavours.`,
    ],
    signatory: DEFAULT_SIGNATORY,
  };
}

/** Experience / relieving letter — issued on exit (needs status=exited + lastWorkingDay). */
export function buildExperienceLetter(e: Employee, opts: { ref: string; date: string }): SimpleLetter {
  const first = firstName(e.name);
  const lwd = e.lastWorkingDay || "the last working day on record";

  return {
    runLabel: "Experience / Relieving Letter",
    title: "EXPERIENCE / RELIEVING LETTER",
    ref: opts.ref,
    date: opts.date,
    salutation: "To Whom It May Concern,",
    paragraphs: [
      `This is to certify that ${e.name} (Employee ID: ${e.employeeId}) was employed with ${COMPANY.legalName} as ${e.designation}${e.department ? ` in the ${e.department} department` : ""} from ${e.dateOfJoining} to ${lwd}.`,
      `During ${first}'s tenure with the Company, ${first} was found to be sincere, diligent, and professional, and ${first}'s overall conduct and performance were satisfactory.`,
      `${first} has been relieved of all duties and responsibilities with effect from the close of business on ${lwd}, upon completion of the applicable exit formalities. All Company and client property, credentials, and data have been accounted for as part of the exit process.`,
      `We thank ${first} for the contribution made to the Company and wish ${first} success in all future endeavours.`,
    ],
    signatory: DEFAULT_SIGNATORY,
  };
}
