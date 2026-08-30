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

/**
 * How long a questionnaire link stays valid after it's sent. ONE constant,
 * imported by both the send route (mints the token + writes the email copy)
 * and the public /q/[token] page (writes the on-page notice) — they drifted
 * out of sync once already (email said 24h, page still hardcoded 36h) when
 * this was two separate hardcoded numbers. Never hardcode this elsewhere.
 */
export const QUESTIONNAIRE_LINK_HOURS = 48;

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

/**
 * One scheduled interview round. `startsAt` is a full ISO instant, not a local
 * date string: a meeting time that doesn't carry its timezone is the classic
 * way to invite someone to 3pm and have them arrive at 8:30pm.
 */
export type Interview = {
  id: string;
  /** ISO 8601 instant, e.g. "2026-07-28T09:30:00.000Z" (= 3:00 PM IST). */
  startsAt: string;
  durationMinutes: number;
  /** Free text — "Himanshu Jain", "Himanshu + Diya". Not an employee link:
   *  panels routinely include people who aren't on the payroll. */
  panel?: string;
  /** Round label the candidate would recognise: "Screening", "Technical". */
  round?: string;
  /** Teams/Meet join URL. Set by Graph when we create the meeting, or pasted
   *  by hand when the meeting was made in Outlook directly. */
  meetingUrl?: string;
  /** Microsoft Graph event id, so we can cancel or update the real calendar
   *  entry later rather than orphaning it. */
  graphEventId?: string;
  /** Whether the candidate was actually sent an invite (vs a private hold). */
  invitedAt?: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
};

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

  /**
   * Scheduled interviews. An array because a candidate can be seen more than
   * once (screen, then a longer conversation) and each round is its own record
   * — collapsing them to a single "interviewedOn" field is how the second round
   * silently overwrites the first.
   */
  interviews?: Interview[];

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
   * Whether the CANDIDATE has opened the link, and when. Engine-owned and set
   * only on a genuine open: the questionnaire page flags its own request as
   * `preview=1` when the visitor holds an HR session, so staff checking their
   * own link never inflates these. No IP or device is recorded — only that it
   * was opened, so this answers "has she seen it?" without tracking her.
   */
  firstViewedAt?: string;
  lastViewedAt?: string;
  viewCount?: number;

  /**
   * If set, this candidate sees THIS questionnaire — a full per-candidate
   * snapshot the HR user has tailored (via /manage-candidates/[seq]/questions).
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
    firstViewedAt: input.firstViewedAt,
    lastViewedAt: input.lastViewedAt,
    viewCount: input.viewCount,
    // Engine-owned like the token state: interviews are created through their
    // own endpoint so a stale form post can't wipe a scheduled meeting.
    interviews: input.interviews,
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

/**
 * One source of truth for "has this candidate been interviewed?" — the
 * scheduler writes structured interviews[], while the older interviewedOn/By
 * are free-text manual fields, so the list column and detail card must read
 * BOTH or a booked round shows as "—". Prefers the real schedule: the most
 * recent PAST round's date, else "Next: <date>" for an upcoming one, else the
 * legacy manual date, else null.
 */
export function interviewDateLabel(c: Candidate): string | null {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  };
  const rounds = (c.interviews ?? []).slice().sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  if (rounds.length > 0) {
    const now = Date.now();
    const past = rounds.filter((r) => new Date(r.startsAt).getTime() <= now);
    if (past.length > 0) return fmt(past[past.length - 1].startsAt);
    return `Next: ${fmt(rounds[0].startsAt)}`;
  }
  return c.interviewedOn || null;
}

/** The panel/interviewer for the same round interviewDateLabel() surfaces,
 * falling back to the legacy free-text interviewedBy. */
export function interviewPanelLabel(c: Candidate): string | null {
  const rounds = (c.interviews ?? []).slice().sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  if (rounds.length > 0) {
    const now = Date.now();
    const past = rounds.filter((r) => new Date(r.startsAt).getTime() <= now);
    const chosen = past.length > 0 ? past[past.length - 1] : rounds[0];
    if (chosen.panel) return chosen.panel;
  }
  return c.interviewedBy || null;
}
