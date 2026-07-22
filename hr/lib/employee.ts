// The employee master record — the single source that feeds both generators
// (offer letter + payslip). Kept dependency-light so it imports cleanly on both
// the server (engine client) and in server components.

import { suggestStructure, type PayslipEmployee, type SalaryStructure } from "./payslip";

export type EmployeeStatus = "active" | "exited";

/** One compensation change, appended by the salary-revision flow (never edited). */
export type CompRevision = {
  effectiveDate: string; // display, e.g. "1 August 2026"
  grossMonthly: number;
  annualCTC: number;
  structure: SalaryStructure;
  reason: string; // e.g. "Annual increment"
  revisedBy: string;
  revisedAt: string; // ISO
};

export type Employee = {
  employeeId: string; // e.g. SSS/EMP/0007
  seq: number; // numeric part, for the next-id counter

  // personal
  name: string;
  address: string;
  pan?: string;
  personalEmail?: string;
  phone?: string;

  // role
  designation: string;
  department: string;
  dateOfJoining: string; // display string, e.g. "2 March 2026"
  employmentType: string; // "Full-time, permanent"
  baseLocation: string;
  reportingTo: string;
  duties: string[]; // offer-letter Section 2 bullets

  // compensation
  grossMonthly: number;
  annualCTC: number;
  structure: SalaryStructure; // Basic/HRA/Conveyance/Special (editable)
  /** Compensation history, oldest first. Appended by the revise-salary flow. */
  revisions?: CompRevision[];

  // probation / internship terms (drive the confirmation + internship letters)
  probationMonths?: number; // default 3 (full-time roles)
  internshipMonths?: number; // internship engagements only

  // bank
  bankAccount?: string;
  bankBranch?: string;
  ifsc?: string;
  paymentMode: string; // "Bank Transfer"

  // statutory ids
  uanPf: string; // "Not Applicable" when none
  esic?: string;

  // meta
  status: EmployeeStatus;
  lastWorkingDay?: string; // display string, set on offboarding (status="exited")
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_EMPLOYMENT_TYPE = "Full-time, permanent";
export const DEFAULT_BASE_LOCATION = "Noida, Uttar Pradesh, India (Remote-first)";
export const DEFAULT_REPORTING_TO = "Founder / Reporting Manager, ShieldSync Security";
export const DEFAULT_PAYMENT_MODE = "Bank Transfer";

// Predefined option lists for the employee form. Every field that uses one still
// allows a free-text "Other (specify)" entry, so these are convenience defaults,
// never a hard constraint.
export const DESIGNATION_OPTIONS = [
  "GRC Analyst",
  "Security Analyst",
  "Senior Security Analyst",
  "SOC Analyst",
  "Penetration Tester",
  "Security Engineer",
  "Cloud Security Engineer",
  "Security Consultant",
  "Security Intern",
  "Executive Assistant",
  "HR Executive",
];
export const DEPARTMENT_OPTIONS = [
  "Governance, Risk & Compliance (GRC)",
  "Security Operations",
  "Offensive Security",
  "Cloud Security",
  "Engineering",
  "Sales & Marketing",
  "Human Resources",
  "Operations",
];
export const EMPLOYMENT_TYPE_OPTIONS = [
  "Full-time, permanent",
  "Full-time, contract",
  "Part-time",
  "Internship",
  "Consultant",
];
export const BASE_LOCATION_OPTIONS = [
  "Noida, Uttar Pradesh, India (Remote-first)",
  "Noida, Uttar Pradesh, India",
  "Remote (India)",
];
export const REPORTING_TO_OPTIONS = [
  "Founder / Reporting Manager, ShieldSync Security",
  "Founder & CEO, ShieldSync Security",
  "HR Director, ShieldSync Security",
];
export const PAYMENT_MODE_OPTIONS = ["Bank Transfer", "UPI", "Cheque", "Cash"];

// A generic duties fallback when a role's bullets aren't provided.
export const DEFAULT_DUTIES = [
  "Perform the duties of your role diligently and to the Company's professional standards.",
  "Follow the Company's security, confidentiality, and data-protection policies at all times.",
  "Collaborate with the team and support Company and client engagements as assigned.",
];

/**
 * Build an employee from a partial form payload, filling role/comp/bank defaults
 * and deriving the salary structure from grossMonthly when not supplied. The
 * engine assigns employeeId + seq + timestamps; those are optional here.
 */
export function normalizeEmployee(input: Partial<Employee>): Omit<Employee, "employeeId" | "seq" | "createdAt" | "updatedAt"> {
  const grossMonthly = Math.max(0, Math.round(Number(input.grossMonthly) || 0));
  const annualCTC = Math.max(0, Math.round(Number(input.annualCTC) || grossMonthly * 12));
  const structure =
    input.structure && input.structure.gross === grossMonthly
      ? input.structure
      : suggestStructure(grossMonthly);

  return {
    name: (input.name ?? "").trim(),
    address: (input.address ?? "").trim(),
    pan: input.pan?.trim() || undefined,
    personalEmail: input.personalEmail?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    designation: (input.designation ?? "").trim(),
    department: (input.department ?? "").trim(),
    dateOfJoining: (input.dateOfJoining ?? "").trim(),
    employmentType: input.employmentType?.trim() || DEFAULT_EMPLOYMENT_TYPE,
    baseLocation: input.baseLocation?.trim() || DEFAULT_BASE_LOCATION,
    reportingTo: input.reportingTo?.trim() || DEFAULT_REPORTING_TO,
    duties: (input.duties ?? []).map((d) => d.trim()).filter(Boolean),
    grossMonthly,
    annualCTC,
    structure,
    revisions: Array.isArray(input.revisions) ? input.revisions : undefined,
    probationMonths: Number(input.probationMonths) > 0 ? Math.round(Number(input.probationMonths)) : undefined,
    internshipMonths: Number(input.internshipMonths) > 0 ? Math.round(Number(input.internshipMonths)) : undefined,
    bankAccount: input.bankAccount?.trim() || undefined,
    bankBranch: input.bankBranch?.trim() || undefined,
    ifsc: input.ifsc?.trim() || undefined,
    paymentMode: input.paymentMode?.trim() || DEFAULT_PAYMENT_MODE,
    uanPf: input.uanPf?.trim() || "Not Applicable",
    esic: input.esic?.trim() || undefined,
    // Status + last working day are PRESERVED, never inferred: an edit to an
    // exited employee must not silently reactivate them (the caller passes the
    // stored values through). Offboarding goes through the /status route only.
    status: input.status === "exited" ? "exited" : "active",
    lastWorkingDay: input.status === "exited" ? input.lastWorkingDay?.trim() || undefined : undefined,
  };
}

/** Map an employee onto the payslip's employee block. */
export function toPayslipEmployee(e: Employee): PayslipEmployee {
  return {
    name: e.name,
    employeeId: e.employeeId,
    designation: e.designation,
    department: e.department,
    dateOfJoining: e.dateOfJoining,
    pan: e.pan,
    bankAccount: e.bankAccount,
    bankBranch: e.bankBranch,
    ifsc: e.ifsc,
    paymentMode: e.paymentMode,
    uanPf: e.uanPf,
  };
}
