// Candidate master record — a HIRING record, deliberately NOT an employee.
//
// Why its own entity: an interviewee is not staff. Minting SSS/EMP ids for
// everyone interviewed would burn the employee series on people never hired and
// drag candidates into payroll/FY/KYC surfaces. More importantly, under the
// DPDP Act the stated purpose differs: employment records are kept for the
// employment relationship, whereas candidate data is collected for THIS
// recruitment and should not be kept forever. Hence a separate table, its own
// id series, and a retention horizon for anyone not hired.
import type { Answers, Questionnaire } from "./questionnaire";

export const CANDIDATE_RETENTION_MONTHS = 12;

export type CandidateOutcome = "pending" | "shortlisted" | "hired" | "rejected" | "withdrawn";

export const OUTCOME_OPTIONS: Array<{ value: CandidateOutcome; label: string }> = [
  { value: "pending", label: "Decision pending" },
  { value: "shortlisted", label: "Shortlisted / next round" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Not selected" },
  { value: "withdrawn", label: "Candidate withdrew" },
];

export const ROLE_OPTIONS = [
  "Executive Assistant",
  "Security Intern",
  "Security Analyst",
  "Cloud Security Engineer",
];

export const SOURCE_OPTIONS = ["Naukri", "LinkedIn", "Indeed", "Referral", "Website", "Consultant / agency", "Walk-in"];

export type Candidate = {
  seq: number;
  candidateId: string; // SSS/CAND/0001
  name: string;
  email: string;
  phone?: string;
  roleAppliedFor: string;
  /** Which questionnaire to send (lib/questionnaire.ts roleKey). */
  questionnaireRole?: string;
  source?: string;
  interviewedOn?: string; // display date
  interviewedBy?: string;
  notes?: string;

  outcome: CandidateOutcome;
  outcomeNote?: string;
  /** Set when converted — links the hiring record to the employee it became. */
  convertedEmployeeId?: string;
  convertedSeq?: number;

  /** Questionnaire link state. The RAW token is never stored — only its hash. */
  tokenHash?: string;
  tokenIssuedAt?: string;
  tokenExpiresAt?: string;
  questionnaireSentTo?: string;
  questionnaireSentAt?: string;
  submittedAt?: string;
  answers?: Answers;

  /**
   * If set, this candidate sees THIS questionnaire — a full per-candidate
   * snapshot the HR user has tailored (via /candidates/[seq]/questions).
   * When undefined, the public page falls back to the default from
   * lib/questionnaire.ts. Editing after send is allowed — it changes what an
   * unsubmitted link shows; once submitted, the snapshot inside `answers`
   * lookup is fixed anyway because the answer keys are stable ids.
   */
  customQuestionnaire?: Questionnaire;

  /**
   * Optional salary proof the candidate uploads with the questionnaire (last
   * payslip / offer letter). Metadata only — bytes live in the encrypted store,
   * exactly one file per candidate, and both are destroyed when the candidate
   * record is deleted.
   */
  salaryProof?: {
    docId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    uploadedAt: string;
  };

  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export function candidateId(seq: number): string {
  return `SSS/CAND/${String(seq).padStart(4, "0")}`;
}

/** Non-hired candidate data has a purpose-limited life; surface when it's due. */
export function retentionDueDate(c: Candidate): string | null {
  if (c.outcome === "hired") return null; // becomes an employment record instead
  const base = new Date(c.createdAt);
  if (Number.isNaN(base.getTime())) return null;
  base.setMonth(base.getMonth() + CANDIDATE_RETENTION_MONTHS);
  return base.toISOString().slice(0, 10);
}

export function isRetentionDue(c: Candidate): boolean {
  const due = retentionDueDate(c);
  return due !== null && due <= new Date().toISOString().slice(0, 10);
}

export type CandidateInput = Partial<Candidate> & { name: string; email: string; roleAppliedFor: string };

export function normalizeCandidate(input: CandidateInput): Omit<Candidate, "seq" | "candidateId" | "createdAt" | "updatedAt"> {
  const outcome = (["pending", "shortlisted", "hired", "rejected", "withdrawn"] as const).includes(input.outcome as CandidateOutcome)
    ? (input.outcome as CandidateOutcome)
    : "pending";
  return {
    name: (input.name ?? "").trim(),
    email: (input.email ?? "").trim().toLowerCase(),
    phone: input.phone?.trim() || undefined,
    roleAppliedFor: (input.roleAppliedFor ?? "").trim(),
    questionnaireRole: input.questionnaireRole?.trim() || undefined,
    source: input.source?.trim() || undefined,
    interviewedOn: input.interviewedOn?.trim() || undefined,
    interviewedBy: input.interviewedBy?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    outcome,
    outcomeNote: input.outcomeNote?.trim() || undefined,
    convertedEmployeeId: input.convertedEmployeeId,
    convertedSeq: input.convertedSeq,
    // Token + submission state are engine-owned; never taken from a form post.
    tokenHash: input.tokenHash,
    tokenIssuedAt: input.tokenIssuedAt,
    tokenExpiresAt: input.tokenExpiresAt,
    questionnaireSentTo: input.questionnaireSentTo,
    questionnaireSentAt: input.questionnaireSentAt,
    submittedAt: input.submittedAt,
    answers: input.answers,
    customQuestionnaire: input.customQuestionnaire,
    salaryProof: input.salaryProof,
    createdBy: input.createdBy,
  };
}

/**
 * What the PUBLIC questionnaire page may ever see. Everything else stays
 * server-side. NOTE: the ENGINES build this projection (`publicCandidate` in
 * hr-server.mjs, `publicView` in hr-handler.mjs) — this type only describes the
 * shape. Add a field here and you must add it in BOTH engines too.
 */
export type PublicCandidateView = {
  name: string;
  roleAppliedFor: string;
  questionnaireRole?: string;
  submittedAt?: string;
  answers?: Answers;
  /** Just the filename, so the form can show "uploaded ✓" — never a URL. */
  salaryProofName?: string;
  /** So the candidate can be told plainly when their link stops working. */
  expiresAt?: string;
  /** Full per-candidate questionnaire, if edited. Public page uses this over the default. */
  customQuestionnaire?: Questionnaire;
};

// (No toPublicView() helper here on purpose — it would look authoritative while
// the engines actually do the projection, which is exactly how the two drift.)
