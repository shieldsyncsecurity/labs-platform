import { notFound, redirect } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { renderIssued } from "@/lib/render-issued";
import { DocToolbar } from "@/components/DocToolbar";
import { humanizeTitle } from "@/lib/server/pdf";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issued document", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; snapshot: unknown };

/** Documents whose entire content IS pay — reading one is reading a salary. */
const PAY_DOCTYPES = new Set(["payslip"]);

// Re-render an issued document EXACTLY as archived (the snapshot is the input;
// the view components are pure). This page is also the print + email surface —
// what leaves the building is always the archived copy, never a live re-render.
export default async function IssuedDoc({ params }: { params: Promise<{ seq: string; genId: string }> }) {
  const { seq, genId } = await params;
  let gen: Gen;
  let employee: Employee | null = null;
  try {
    gen = (await hrFetch<{ gen: Gen }>(`/hr/employees/${seq}/generated/${genId}`)).gen;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }
  try {
    employee = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch {
    /* employee may have been deleted; the archived doc still renders */
  }

  // An issued PAYSLIP is a pay figure in document form: gross, every deduction,
  // net. Re-opening one is `documents: read`, which is not the salary
  // permission — so without this, someone barred from seeing pay on the record
  // could read all of it from the archived slips instead. Letters that merely
  // MENTION pay (an offer) are the document-issuer's own work and stay
  // available; a payslip has no purpose except the numbers.
  const { isAdmin, access } = await getViewer();
  if (PAY_DOCTYPES.has(gen.docType) && !(isAdmin || access.seeSalary)) {
    redirect(`/no-access?area=payroll`);
  }

  const toolbar = (
    <DocToolbar
      backHref={`/employees/${seq}`}
      backLabel={employee?.name ?? "Back to employee"}
      pdfHref={`/api/employees/${seq}/issued/${gen.docId}/pdf`}
      email={{
        seq,
        genId: gen.docId,
        defaultTo: employee?.personalEmail,
        defaultSubject: `${humanizeTitle(gen.title || "Document")}${gen.ref ? ` — ${gen.ref}` : ""}`,
      }}
    />
  );

  const el = renderIssued(gen.docType, gen.snapshot, toolbar);
  if (!el) notFound();
  return el;
}
