// Single source of truth for ShieldSync's legal identity on internal HR
// letterhead (offer/appointment letters, payslips, verification letters).
//
// These values are transcribed from the company's own FINALIZED, signed
// documents (the CIN etc. are printed on every letterhead), so anything this
// portal generates matches the signed originals exactly. Reference set:
//   Projects\ShieldSync Documents\Diya Visa\Final\
//
// DRIFT GUARD: the enterprise GST-invoice path already reads
// SHIELDSYNC_GSTIN / SHIELDSYNC_ADDRESS / SHIELDSYNC_STATE
// (labs-platform/enterprise/app/admin/orgs/[orgId]/orders/[orderId]/invoice/invoice-model.ts).
// This module reads the SAME env names so the two apps' company block can never
// diverge. GSTIN is NOT printed on HR letterhead today (the entity may not be
// GST-registered yet) -- it renders only when the env value is set.

export const COMPANY = {
  legalName: "ShieldSync Security Private Limited",
  shortName: "ShieldSync",
  tagline: "Empowering Cybersecurity Futures",
  cin: "U62090UP2025PTC225398",
  // Entity (company) PAN — the "C" in the 4th position marks it a company. This
  // is the COMPANY's PAN, distinct from the EMPLOYEE PAN shown on payslips.
  // Used only where a company statutory identifier is required (e.g. TDS / Form
  // 16 output later); not printed on the standard letterhead.
  pan: "ABQCS4200G",
  email: "info@shieldsyncsecurity.com",
  // HR correspondence address — used on letters (offer/appointment) so replies
  // and acceptances route to HR (the hr@ mailbox is the EA's portal seat), not
  // the general info@ inbox.
  hrEmail: "hr@shieldsyncsecurity.com",
  phone: "+91 97174 33114",
  website: "www.shieldsyncsecurity.com",
  // The letterhead location line, exactly as it appears on signed documents.
  locationLine: "Noida, Uttar Pradesh, India",
  state: "Uttar Pradesh",
  governingLaw: "India",
  jurisdiction: "Uttar Pradesh, India",
} as const;

// Uttar Pradesh does NOT levy Professional Tax. Surfaced verbatim on payslips as
// the standard explanatory note, and used to default the PT toggle off for the
// UP-registered entity. (Confirmed on the signed Diya Jain payslips.)
export const PROFESSIONAL_TAX_LEVIED_IN_STATE = false;

/** Full registered office address; env override, else the letterhead location line. */
export function registeredAddress(): string {
  return (process.env.SHIELDSYNC_ADDRESS ?? "").trim() || COMPANY.locationLine;
}

/** GSTIN, or null when unset (do not render a placeholder into a legal document). */
export function gstin(): string | null {
  const g = (process.env.SHIELDSYNC_GSTIN ?? "").trim();
  return g || null;
}

// Default authorised signatory block (from the signed appointment letter and
// payslips). Overridable per document if a different person signs.
export const DEFAULT_SIGNATORY = {
  name: "Ms. Rachna",
  designation: "HR Director",
} as const;

// Document reference schemes, matching the company's existing numbering.
//   Offer / appointment letters : SSS/HR/<year>/<seq3>  e.g. SSS/HR/2026/002
//   Employee IDs                : SSS/EMP/<seq4>         e.g. SSS/EMP/0007
export function offerRef(year: number, seq: number): string {
  return `SSS/HR/${year}/${String(seq).padStart(3, "0")}`;
}
export function employeeId(seq: number): string {
  return `SSS/EMP/${String(seq).padStart(4, "0")}`;
}
