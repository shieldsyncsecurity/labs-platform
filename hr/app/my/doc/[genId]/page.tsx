import { redirect, notFound } from "next/navigation";
import { getSelfSession } from "@/lib/server/self-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { renderIssued } from "@/lib/render-issued";
import { SelfDocActions } from "@/components/SelfDocActions";
import { humanizeTitle } from "@/lib/server/pdf";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "Document — ShieldSync", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; snapshot: unknown };

// The fetch is /hr/employees/:seq/generated/:genId with seq from her SIGNED
// cookie, never from this route's params — she cannot substitute another
// employee's genId and see their document; the engine's composite key
// (employeeSeq, docId) means a mismatched pair just 404s.
export default async function MyDoc({ params }: { params: Promise<{ genId: string }> }) {
  const session = await getSelfSession();
  if (!session) redirect("/my/login");

  const { genId } = await params;
  let gen: Gen;
  try {
    gen = (await hrFetch<{ gen: Gen }>(`/hr/employees/${session.seq}/generated/${encodeURIComponent(genId)}`)).gen;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }
  let employee: Employee | null = null;
  try {
    employee = (await hrFetch<{ employee: Employee }>(`/hr/employees/${session.seq}`)).employee;
  } catch {
    /* toolbar still works without a default recipient */
  }

  const toolbar = (
    <SelfDocActions
      genId={gen.docId}
      defaultTo={employee?.personalEmail}
      defaultSubject={`${humanizeTitle(gen.title || "Document")}${gen.ref ? ` — ${gen.ref}` : ""}`}
    />
  );

  const el = renderIssued(gen.docType, gen.snapshot, toolbar);
  if (!el) notFound();
  return el;
}
