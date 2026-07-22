import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { PayslipDoc } from "@/components/PayslipDoc";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { InternshipOfferDoc } from "@/components/InternshipOfferDoc";
import { DocToolbar } from "@/components/DocToolbar";
import type { OfferLetter } from "@/lib/documents/offer-letter";
import type { Payslip } from "@/lib/payslip";
import type { SimpleLetter } from "@/lib/documents/letters";
import type { InternshipOffer } from "@/lib/documents/internship";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issued document", robots: { index: false, follow: false } };

type Gen = { docType: string; title: string; ref: string; snapshot: unknown };

// Re-render an issued document exactly as it was saved (from its frozen input
// snapshot — the view components are pure functions of their props).
export default async function IssuedDoc({ params }: { params: Promise<{ seq: string; genId: string }> }) {
  const { seq, genId } = await params;
  let gen: Gen;
  try {
    gen = (await hrFetch<{ gen: Gen }>(`/hr/employees/${seq}/generated/${genId}`)).gen;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  const toolbar = <DocToolbar backHref={`/employees/${seq}`} backLabel="Back to employee" />;

  switch (gen.docType) {
    case "offer":
      return <OfferLetterDoc letter={gen.snapshot as OfferLetter} toolbar={toolbar} />;
    case "payslip":
      return <PayslipDoc payslip={gen.snapshot as Payslip} toolbar={toolbar} />;
    case "verification":
    case "experience":
    case "leave":
    case "increment":
    case "confirmation":
    case "completion":
      return <SimpleLetterDoc letter={gen.snapshot as SimpleLetter} toolbar={toolbar} />;
    case "internship-offer":
      return <InternshipOfferDoc offer={gen.snapshot as InternshipOffer} toolbar={toolbar} />;
    default:
      notFound();
  }
}
