import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildResignationAcceptanceLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resignation acceptance letter", robots: { index: false, follow: false } };

// Mirrors the experience/relieving generate page. No exit-status precondition:
// a resignation is accepted when notice is tendered (the employee is usually
// still active, serving out their notice), and the builder falls back to "the
// last working day on record" when one isn't set yet. Gating is by the URL map
// (hr/lib/access-routes.ts → documents:write), same as every other letter.
export default async function GenerateResignationAcceptance({
  params,
  searchParams,
}: {
  params: Promise<{ seq: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { seq } = await params;
  const sp = await searchParams;
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${seq}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  const now = new Date();
  const letter = buildResignationAcceptanceLetter(e, {
    ref: sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`,
    date: todayDisplay(),
    noticeDays: sp.notice ? Number(sp.notice) || undefined : undefined,
  });

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <DocToolbar
          backHref={`/employees/${seq}`}
          backLabel={e.name}
          save={{ seq, docType: "resignation-acceptance", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
          email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Acceptance of Resignation — ${e.name}` }}
        />
      }
    />
  );
}
