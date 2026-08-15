// Internship offer letter — plain-language redesign (v4, owner-approved
// 26 Jul 2026). Reads as a company letter, not a legal contract: institutional
// section headings, no contractions or exclamation marks, but short plain
// sentences rather than clause-soup. Content is sourced from the company's own
// Internshala posting for the Executive Assistant role plus the founder's
// specific terms (hours, stipend, term).
//
// Distinct from the full-time appointment letter — no probation/PF machinery.

import { COMPANY, DEFAULT_SIGNATORY } from "../company";
import type { Employee } from "../employee";

export type InternshipOffer = {
  ref: string; // SSS/INT/2026/001
  date: string;
  addressee: { name: string; address?: string };
  intro: string;
  /** The "Internship at a Glance" grid — six label/value cells. */
  glanceRows: Array<{ label: string; value: string }>;
  /** The highlighted stipend band under the glance grid. */
  stipend: { amount: string; note: string };
  sections: Array<{
    n: number;
    heading: string;
    intro?: string;
    bullets?: string[];
  }>;
  closing: string;
  signatory: { name: string; designation: string };
  /** The "collect original in person" watermark assumes the intern is coming
   * into the office — false for a fully remote engagement (or, as with a
   * backdated/retrospective letter, someone who already left). Defaults to
   * showing it (unchanged for everyone else) when omitted. */
  noWatermark?: boolean;
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
      "Maintaining and updating Excel sheets, trackers, and basic reports.",
      "Carrying out simple financial calculations — EMI/ROI-style workings and summaries — using standard tools as required.",
      "Managing day-to-day administrative tasks: scheduling meetings, calendar management, call coordination, reminders, and follow-ups.",
      "Preparing and formatting documents such as proposals, reports, and presentations in Word, PowerPoint, and PDF.",
      "Coordinating with clients, vendors, and other contacts by phone, email, and message in a professional manner.",
      "Supporting marketing activities, including scheduling social media posts and publishing blog and marketing content.",
      "Handling ad-hoc tasks for the founder's office, including online research, booking appointments, and basic documentation.",
      "Maintaining office organisation, including digital and physical filing and record-keeping.",
      "Learning new tools, processes, and templates, and improving how recurring tasks are carried out.",
    ];
  }

  if (/security|cloud|soc|analyst|engineer|grc|compliance/.test(d)) {
    return [
      "Assisting with auditing and hardening AWS environments — IAM policies and roles, S3 bucket policies, KMS key usage, and VPC security groups — under the guidance of a mentor.",
      "Learning AWS-native security tooling, including GuardDuty, Security Hub, and CloudTrail, and how findings from them are triaged.",
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
  opts: {
    ref: string;
    date: string;
    startDate?: string;
    mentor?: string;
    scopeBullets?: string[];
    noWatermark?: boolean;
    /** Time to report on the start date — shown in the glance grid, separate
     * from the standing daily "Hours" row (the two can differ, e.g. an
     * earlier first-day check-in). Omitted entirely when not set. */
    reportingTime?: string;
    /** Overrides the standard 12:00 noon – 8:00 PM hours. Provide both the
     * short glance-box form and the fuller sentence used in the body. */
    hours?: { glance: string; body: string; stretchEnd?: string };
    /** Overrides the flat exit-notice bullet with a tiered one — shorter
     * notice during an initial period, longer after. Optional: everyone
     * else keeps the standard flat fifteen (15) days' notice. */
    tieredNotice?: { probationMonths: number; probationNoticeDays: number; postNoticeMonths: number };
  },
): InternshipOffer {
  const months = e.internshipMonths ?? 2;
  const monthsWord = `${months} month${months === 1 ? "" : "s"}`;

  const scope =
    opts.scopeBullets && opts.scopeBullets.length > 0
      ? opts.scopeBullets
      : e.duties.length > 0
        ? e.duties
        : defaultScopeFor(e.designation);

  // The FIXED stipend and any performance incentive are stated separately on
  // purpose. Rolling them into one figure would commit the company to paying
  // the incentive as guaranteed pay — the intern could reasonably hold us to
  // the combined number, which defeats the point of making it performance-linked.
  // No figure is stated at all, deliberately: naming an amount (even "up to X")
  // reads as a ceiling the Company has committed to, which constrains exactly
  // the discretion this clause exists to preserve. variableMax still lives on
  // the employee record as an internal planning number — it just never prints.
  const incentiveBullet = e.variableMax
    ? "In addition, a discretionary performance incentive may be paid each month, entirely at the Company's discretion — the amount and whether it is paid at all are decided by the Company. This is not guaranteed, and a month in which none is paid is not a breach of this letter."
    : null;

  const location = e.baseLocation || "Noida, Uttar Pradesh, India";
  const hours = opts.hours ?? { glance: "12:00 noon – 8:00 PM", body: "12:00 noon to 8:00 PM" };

  return {
    ref: opts.ref,
    date: opts.date,
    addressee: { name: e.name, address: e.address || undefined },
    intro: `We are pleased to offer you an internship with ${COMPANY.legalName} ("${COMPANY.shortName}", "the Company"). You will work closely with the founder across all aspects of the business, giving you a close view of how a technology business is actually built and run. The details of your internship are set out below.`,
    glanceRows: [
      { label: "Position", value: e.designation },
      { label: "Engagement", value: `Internship · ${monthsWord}` },
      { label: "Start Date", value: opts.startDate || e.dateOfJoining },
      ...(opts.reportingTime ? [{ label: "Reporting Time", value: opts.reportingTime }] : []),
      { label: "Hours", value: `Monday to Friday, ${hours.glance}` },
      { label: "Reporting To", value: opts.mentor || "Founder, ShieldSync Security" },
      { label: "Location", value: location },
    ],
    stipend:
      e.grossMonthly > 0
        ? { amount: `₹${fmt(e.grossMonthly)}`, note: "per month · paid by bank transfer for the preceding month" }
        : { amount: "Unpaid", note: "no stipend payable for this internship" },
    sections: [
      {
        n: 1,
        heading: "Role and Responsibilities",
        intro: "You will work closely with the founder across all aspects of the business — a founder's-office role that is varied, fast-paced, and hands-on. Your responsibilities will include:",
        bullets: [...scope, "Any other reasonable tasks assigned to you from time to time, in line with your role and experience."],
      },
      {
        n: 2,
        heading: "Learning and Development",
        bullets: [
          "You will gain exposure to how a cybersecurity business is run end to end — including clients, products, marketing, compliance, and finance.",
          "You will use AI tools such as ChatGPT and Claude as part of your daily work.",
          "No prior cybersecurity knowledge is required; the Company will provide the guidance you need.",
        ],
      },
      {
        n: 3,
        heading: "Working Hours and Location",
        bullets: [
          `Working days are Monday to Friday, ${hours.body}${hours.stretchEnd ? `, extendable up to ${hours.stretchEnd} as required` : ""}, at the Company's office in ${location}.`,
          "You will have a dedicated desk at the Company's office. The dress code is formal / smart-business wear.",
          "You are entitled to a short break during the working day.",
        ],
      },
      {
        n: 4,
        heading: "Stipend and Leave",
        bullets: [
          e.grossMonthly > 0
            ? `Your stipend is INR ${fmt(e.grossMonthly)} per month.`
            : "This is an unpaid internship; no stipend is payable.",
          ...(incentiveBullet ? [incentiveBullet] : []),
          ...(e.grossMonthly > 0
            ? ["The stipend is paid by bank transfer for the preceding month, ordinarily within the first ten working days of the following month."]
            : []),
          "Saturdays and Sundays are off. No other leave is granted; any additional day taken will be deducted from that month's stipend on a per-day basis.",
        ],
      },
      {
        n: 5,
        heading: "Confidentiality",
        bullets: [
          "In the course of this internship you may have access to information that is not public — including client details, Company plans, financial information, and personnel records. You must keep this information confidential, both during and after the internship.",
          "Any work you produce during the internship — documents, presentations, trackers, or similar material — belongs to the Company, and you assign to the Company all rights in it, including copyright.",
          "You must not upload, email, or otherwise transfer Company documents to any personal device, account, or email address.",
          "You must use only the systems and accounts provided to you for Company work, and must not copy Company or client data to any personal device or account. Personal data you handle must be used only as instructed, and any suspected data issue must be reported to the Company immediately.",
        ],
      },
      {
        n: 6,
        heading: "Conflict of Interest & Non-Solicitation",
        bullets: [
          "During the internship, you must not undertake any work that conflicts with your duties at the Company.",
          "For twelve months after the internship ends, you must not approach the Company's clients or team members with a view to taking their business or persuading them to leave. This does not restrict where you may work after the internship ends.",
        ],
      },
      {
        n: 7,
        heading: "Term and General Conditions",
        bullets: [
          "This is an internship and not an offer of employment. It does not create an employer-employee relationship, and statutory benefits such as provident fund, gratuity, and notice pay do not apply. The stipend is not a salary.",
          `The internship runs for ${monthsWord} from the start date and ends automatically at the end of the term unless extended by mutual written agreement.`,
          opts.tieredNotice
            ? `For the first ${opts.tieredNotice.probationMonths === 1 ? "month" : `${opts.tieredNotice.probationMonths} months`}, either party may end the internship earlier by giving ${opts.tieredNotice.probationNoticeDays === 7 ? "seven (7)" : `${opts.tieredNotice.probationNoticeDays}`} days' written notice. After that, either party may end it earlier by giving ${opts.tieredNotice.postNoticeMonths === 1 ? "one (1) month's" : `${opts.tieredNotice.postNoticeMonths} months'`} written notice. The Company may end it immediately in cases of serious misconduct, breach of confidentiality, or dishonesty.`
            : "Either party may end the internship earlier by giving fifteen (15) days' written notice. The Company may end it immediately in cases of serious misconduct, breach of confidentiality, or dishonesty.",
          "On satisfactory completion of the full term, a Certificate of Completion will be issued. On completion or earlier termination, you must return all Company property in your possession.",
          "This offer is subject to the accuracy of the information you have provided. This letter constitutes the entire agreement between the parties on this engagement, and any changes must be agreed in writing.",
          `This letter is governed by the laws of ${COMPANY.governingLaw}, and any dispute relating to it will be decided by the courts in ${COMPANY.jurisdiction}.`,
        ],
      },
    ],
    closing:
      "Please read this letter carefully. If any part of it is unclear or does not match your understanding, raise it with the Company before signing. To accept this offer, please sign and return a copy of this letter.",
    signatory: DEFAULT_SIGNATORY,
    noWatermark: opts.noWatermark,
  };
}
