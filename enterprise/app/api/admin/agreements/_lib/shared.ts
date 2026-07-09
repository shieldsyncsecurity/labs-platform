// Shared validation + typing for the admin agreements routes (W3-4).
// The engine (ShieldSyncEntAgreements table) is the source of truth for
// status transitions; these routes only validate shape/size and forward the
// staff actor. Params shape mirrors W3-1 exactly.

export const AGREEMENT_DOC_TYPES = ["msa", "dpa"] as const;
export type AgreementDocType = (typeof AGREEMENT_DOC_TYPES)[number];

// W3-1: bodyText is the FULL rendered snapshot incl. negotiated edits, <=200KB.
export const MAX_BODY_TEXT_CHARS = 200_000;

export type AgreementParams = {
  companyLegalName: string;
  registeredAddress: string;
  gstin?: string;
  signatoryName: string;
  signatoryTitle: string;
  effectiveDate: string;
  governingLaw: string;
};

type FieldRule = { key: keyof AgreementParams; label: string; max: number; required: boolean };

const PARAM_RULES: FieldRule[] = [
  { key: "companyLegalName", label: "Company legal name", max: 200, required: true },
  { key: "registeredAddress", label: "Registered address", max: 500, required: true },
  { key: "gstin", label: "GSTIN", max: 20, required: false },
  { key: "signatoryName", label: "Signatory name", max: 120, required: true },
  { key: "signatoryTitle", label: "Signatory title", max: 120, required: true },
  { key: "effectiveDate", label: "Effective date", max: 10, required: true },
  { key: "governingLaw", label: "Governing law", max: 80, required: true },
];

/**
 * Validates the raw params object from the client. Returns the trimmed,
 * clamped params or a human-readable error. The engine stores params
 * verbatim, so this route is the size/shape gate.
 */
export function parseAgreementParams(raw: unknown): { params?: AgreementParams; error?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "params object is required" };
  }
  const source = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const rule of PARAM_RULES) {
    const value = typeof source[rule.key] === "string" ? (source[rule.key] as string).trim() : "";
    if (!value) {
      if (rule.required) return { error: `${rule.label} is required` };
      continue; // optional + empty -> omit
    }
    if (value.length > rule.max) {
      return { error: `${rule.label} must be at most ${rule.max} characters` };
    }
    out[rule.key] = value;
  }
  // effectiveDate comes from an <input type="date"> -- enforce the format so
  // the rendered legal text never carries junk.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.effectiveDate ?? "")) {
    return { error: "Effective date must be YYYY-MM-DD" };
  }
  return { params: out as AgreementParams };
}

export function isAgreementDocType(value: unknown): value is AgreementDocType {
  return value === "msa" || value === "dpa";
}

/**
 * Extracts the engine's coded error (NOT_DRAFT / NOT_ISSUABLE / NOT_VOIDABLE
 * ...) from an EntEngineError body so routes can map it to a friendly 409.
 */
export function engineErrorCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const code = (body as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return null;
}
