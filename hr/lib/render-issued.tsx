// Single source for turning an issued-document snapshot back into its view
// element — used by the issued page (screen/print) AND the server-side PDF
// route, so what you see, what you print, and what gets emailed are the same
// render of the same archived snapshot.
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { PayslipDoc } from "@/components/PayslipDoc";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { InternshipOfferDoc } from "@/components/InternshipOfferDoc";
import type { OfferLetter } from "@/lib/documents/offer-letter";
import type { Payslip } from "@/lib/payslip";
import type { SimpleLetter } from "@/lib/documents/letters";
import type { InternshipOffer } from "@/lib/documents/internship";

export const SIMPLE_LETTER_TYPES = new Set([
  "verification",
  "experience",
  "leave",
  "increment",
  "confirmation",
  "completion",
  "employment-history",
  "resignation-acceptance",
  "fnf",
]);

/** True when an object has every listed key as an own, defined property —
 * the minimum needed for the component's unguarded field access (`.map`,
 * `.trim()`, destructuring) not to throw. Not a full shape validation, just
 * enough to catch a partially-written or pre-migration snapshot. */
function hasFields(snapshot: unknown, fields: string[]): snapshot is Record<string, unknown> {
  if (!snapshot || typeof snapshot !== "object") return false;
  return fields.every((f) => (snapshot as Record<string, unknown>)[f] !== undefined);
}

/**
 * Render a stored snapshot through the CURRENT components, or null when the
 * docType is unknown OR the snapshot is missing a field its component reads
 * unguarded (callers 404 either way). Every field here is typed as REQUIRED
 * in its builder, so under normal generation this never fires — the actual
 * exposure is a partially-written DB record, a manual edit, or a future
 * schema change dropping a field without a migration. Without this check
 * such a snapshot reached OfferLetterDoc/PayslipDoc/InternshipOfferDoc as a
 * raw cast with zero runtime validation, throwing a bare TypeError on the
 * ONE shared render path for the issued-document view, print, AND the
 * server-side PDF/email route — one bad record broke all three surfaces.
 * Degrading to "unavailable" here is strictly better than a hard crash.
 */
export function renderIssued(docType: string, snapshot: unknown, toolbar?: React.ReactNode): React.ReactElement | null {
  switch (true) {
    case docType === "offer":
      if (!hasFields(snapshot, ["addressee", "positionRows", "sections", "annexure"])) return null;
      return <OfferLetterDoc letter={snapshot as OfferLetter} toolbar={toolbar} />;
    case docType === "payslip":
      if (!hasFields(snapshot, ["employee", "period", "earnings", "deductions"])) return null;
      return <PayslipDoc payslip={snapshot as Payslip} toolbar={toolbar} />;
    case docType === "internship-offer":
      if (!hasFields(snapshot, ["addressee", "glanceRows", "sections"])) return null;
      return <InternshipOfferDoc offer={snapshot as InternshipOffer} toolbar={toolbar} />;
    case SIMPLE_LETTER_TYPES.has(docType):
      if (!hasFields(snapshot, ["paragraphs", "signatory"])) return null;
      return <SimpleLetterDoc letter={snapshot as SimpleLetter} toolbar={toolbar} />;
    default:
      return null;
  }
}
