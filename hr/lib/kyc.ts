// KYC document model — sensitive employee PII (DPDP: sensitive personal data).
// Bytes live ONLY in the isolated, SSE-KMS encrypted HR bucket (prod) or the
// local dev store; this module is just the shared shape + validation used by
// both the API routes and the UI.

export type KycKind =
  | "aadhaar"
  | "pan"
  | "bank_proof"
  | "photo"
  | "signed_offer"
  | "education"
  | "experience"
  | "other";

export const KYC_KINDS: { value: KycKind; label: string }[] = [
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN card" },
  { value: "bank_proof", label: "Bank proof (cancelled cheque / passbook)" },
  { value: "photo", label: "Photograph" },
  { value: "signed_offer", label: "Signed offer / appointment letter" },
  { value: "education", label: "Education certificate" },
  { value: "experience", label: "Experience / relieving letter" },
  { value: "other", label: "Other" },
];

export function kindLabel(k: string): string {
  return KYC_KINDS.find((x) => x.value === k)?.label ?? "Other";
}

/** Metadata row — NEVER carries the bytes. */
export type KycDoc = {
  docId: string;
  employeeSeq: number;
  kind: KycKind;
  label: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
};

// 4 MB per file — the production ceiling: bytes travel base64-in-JSON through
// API Gateway to Lambda, whose synchronous payload caps at 6 MB each way
// (4 MB × 4/3 ≈ 5.4 MB). A higher cap would pass in dev and 502 in prod.
export const MAX_KYC_BYTES = 4 * 1024 * 1024;

// Only document/image types a KYC pack legitimately needs.
export const ALLOWED_KYC_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
