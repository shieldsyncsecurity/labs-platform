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
]);

/** Render a stored snapshot through the CURRENT components, or null for an
 * unknown docType (callers 404). */
export function renderIssued(docType: string, snapshot: unknown, toolbar?: React.ReactNode): React.ReactElement | null {
  switch (true) {
    case docType === "offer":
      return <OfferLetterDoc letter={snapshot as OfferLetter} toolbar={toolbar} />;
    case docType === "payslip":
      return <PayslipDoc payslip={snapshot as Payslip} toolbar={toolbar} />;
    case docType === "internship-offer":
      return <InternshipOfferDoc offer={snapshot as InternshipOffer} toolbar={toolbar} />;
    case SIMPLE_LETTER_TYPES.has(docType):
      return <SimpleLetterDoc letter={snapshot as SimpleLetter} toolbar={toolbar} />;
    default:
      return null;
  }
}
