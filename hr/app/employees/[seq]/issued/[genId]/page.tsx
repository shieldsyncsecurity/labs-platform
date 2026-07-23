import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { renderIssued } from "@/lib/render-issued";
import { DocToolbar } from "@/components/DocToolbar";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Issued document", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; snapshot: unknown };

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

  const toolbar = (
    <DocToolbar
      backHref={`/employees/${seq}`}
      backLabel={employee?.name ?? "Back to employee"}
      pdfHref={`/api/employees/${seq}/issued/${gen.docId}/pdf`}
      email={{
        seq,
        genId: gen.docId,
        defaultTo: employee?.personalEmail,
        defaultSubject: `${gen.title || "Document"}${gen.ref ? ` — ${gen.ref}` : ""}`,
      }}
    />
  );

  const el = renderIssued(gen.docType, gen.snapshot, toolbar);
  if (!el) notFound();
  return el;
}
