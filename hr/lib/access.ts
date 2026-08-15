// Role + permission model for the HR portal.
//
// Two kinds of user:
//   ADMIN — the owner. Full access to everything, ALWAYS, derived from an
//           environment allowlist and never from stored data. This is what makes
//           self-lockout impossible: a corrupted, empty, or maliciously edited
//           grants record cannot take the owner's own access away.
//   STAFF — anyone else on HR_ALLOWLIST (today: the EA on hr@). Their access is
//           stored in the data plane and edited by the admin at /access.
//
// Pure module — no next/headers, no engine calls — so the client editor, the
// server guards, and the tests all share ONE definition of what a permission is.

export const AREAS = ["candidates", "employees", "documents", "payroll", "kyc", "banking", "audit"] as const;
export type Area = (typeof AREAS)[number];

export type Level = "none" | "read" | "write";
export const LEVELS: Level[] = ["none", "read", "write"];

export type Access = {
  areas: Record<Area, Level>;
  /** Salary figures (gross, CTC, the four structure components) on employee
   * records and payroll screens. Separate from `employees` because "can open a
   * colleague's record" and "can see what they earn" are different decisions. */
  seeSalary: boolean;
  /** Employee bank account number, IFSC and PAN. Same reasoning: an EA may need
   * to maintain a record without holding the details that enable a payment. */
  seeBankDetails: boolean;
};

/** What each area actually governs, in the owner's words — shown in the editor
 * so a permission is chosen by consequence, not by guessing at a noun. */
export const AREA_META: Record<Area, { label: string; blurb: string; readMeans: string; writeMeans: string }> = {
  candidates: {
    label: "Recruiting",
    blurb: "Candidate pipeline, interview questionnaires and their answers.",
    readMeans: "See candidates and what they answered.",
    writeMeans: "Add or edit candidates, tailor and send questionnaires, hire.",
  },
  employees: {
    label: "Employee records",
    blurb: "The staff master records — who works here and on what terms.",
    readMeans: "Open employee records.",
    writeMeans: "Add employees, edit details, revise salary, offboard.",
  },
  documents: {
    label: "Letters & issued documents",
    blurb: "Offer, appointment, leave, verification and experience letters.",
    readMeans: "See what has been issued to whom.",
    // Stated plainly because it is NOT closable by a permission: an offer or
    // appointment letter states the salary, so anyone who can issue or reopen
    // one necessarily reads the pay printed in it, whatever "Salary figures"
    // below is set to. (Payslips are the exception — those are pure pay and DO
    // require the salary permission, on the page and on the PDF.)
    writeMeans: "Issue new letters and withdraw ones sent in error. Note: offer and appointment letters state the salary, so this also means seeing the pay written in those letters.",
  },
  payroll: {
    label: "Payroll",
    blurb: "Monthly salary slips and the April–March tax summary.",
    readMeans: "See which months are done.",
    writeMeans: "Generate salary slips and run the FY summary.",
  },
  kyc: {
    label: "ID vault",
    blurb: "Aadhaar, PAN, bank proof and stored original documents.",
    readMeans: "Download identity documents.",
    writeMeans: "Upload and delete identity documents.",
  },
  banking: {
    label: "Banking",
    blurb: "The company bank ledger — all money in and out.",
    readMeans: "See the ledger and every transaction.",
    writeMeans: "Import statements, categorise and annotate transactions.",
  },
  audit: {
    label: "Audit trail",
    blurb: "Who did what, when — including everything the admin did.",
    readMeans: "Read and export the audit log.",
    writeMeans: "Same as read; the log itself is append-only.",
  },
};

/** Nobody, by default. A new or unknown user gets nothing until granted — the
 * only safe default when the store is the thing being consulted. */
export function noAccess(): Access {
  return {
    areas: { candidates: "none", employees: "none", documents: "none", payroll: "none", kyc: "none", banking: "none", audit: "none" },
    seeSalary: false,
    seeBankDetails: false,
  };
}

export function fullAccess(): Access {
  return {
    areas: { candidates: "write", employees: "write", documents: "write", payroll: "write", kyc: "write", banking: "write", audit: "write" },
    seeSalary: true,
    seeBankDetails: true,
  };
}

/**
 * Starting point offered for an Executive Assistant: runs recruiting and issues
 * letters, can see who works here, but not what they are paid, not their ID
 * documents, and not the company's money. Deliberately a SUGGESTION the admin
 * applies and can then edit — never applied automatically, because "we defaulted
 * her into it" is not an answer to "who gave her access to that?".
 */
export function assistantPreset(): Access {
  return {
    areas: { candidates: "write", employees: "read", documents: "write", payroll: "none", kyc: "none", banking: "none", audit: "none" },
    seeSalary: false,
    seeBankDetails: false,
  };
}

/** Read-only across day-to-day operations — someone who needs to see the state
 * of recruiting, records and documents without being able to change anything or
 * see money-enabling details. Deliberately NO payroll: every payroll surface
 * also requires the salary permission, so `payroll: read` with `seeSalary: false`
 * would be a dead-end that falsely advertises access this viewer can never use. */
export function viewerPreset(): Access {
  return {
    areas: { candidates: "read", employees: "read", documents: "read", payroll: "none", kyc: "none", banking: "none", audit: "none" },
    seeSalary: false,
    seeBankDetails: false,
  };
}

/** Named roles the admin can apply with one click at /access. Each is a
 * STARTING POINT the admin then edits — never applied automatically. */
export const ROLE_PRESETS: Array<{ key: string; label: string; blurb: string; make: () => Access }> = [
  {
    key: "assistant",
    label: "Executive Assistant",
    blurb: "Runs recruiting, maintains records, issues letters. No pay figures, no ID vault, no banking.",
    make: assistantPreset,
  },
  {
    key: "viewer",
    label: "Read-only viewer",
    blurb: "Sees recruiting, records and documents. Changes nothing, sees no pay figures.",
    make: viewerPreset,
  },
];

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

/** Does `access` satisfy `need` on `area`? Write implies read. */
export function can(access: Access, area: Area, need: "read" | "write"): boolean {
  return RANK[access.areas[area] ?? "none"] >= RANK[need];
}

/** Coerce anything (stored JSON, a form post) into a valid Access. Unknown or
 * malformed values fail CLOSED to "none" rather than inheriting a default. */
export function normalizeAccess(input: unknown): Access {
  const out = noAccess();
  if (!input || typeof input !== "object") return out;
  const raw = input as { areas?: Record<string, unknown>; seeSalary?: unknown; seeBankDetails?: unknown };
  for (const area of AREAS) {
    const v = raw.areas?.[area];
    if (typeof v === "string" && (LEVELS as string[]).includes(v)) out.areas[area] = v as Level;
  }
  out.seeSalary = raw.seeSalary === true;
  out.seeBankDetails = raw.seeBankDetails === true;
  return out;
}

/** Mask a figure the viewer isn't allowed to see. Returns the em-dash the rest
 * of the UI already uses for "nothing here", so a masked cell never looks like
 * a zero or a bug. */
export const MASKED = "—";
