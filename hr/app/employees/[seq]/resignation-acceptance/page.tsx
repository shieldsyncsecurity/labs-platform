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
    date: sp.date?.trim() || todayDisplay(),
    noticeDays: sp.notice ? Number(sp.notice) || undefined : undefined,
    tenderedOn: sp.tendered,
    lastWorkingDay: sp.lwd,
  });

  const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 7, marginLeft: 6 };
  // GET form — every field round-trips through the URL, so a saved snapshot's
  // ?ref reload reproduces the letter exactly as issued.
  const configBar = (
    <form method="get" style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5, marginBottom: 10 }}>
      <label>Tendered on <input name="tendered" defaultValue={sp.tendered ?? ""} placeholder="11 August 2026" style={{ ...cfgInput, width: 140 }} /></label>
      <label>Last working day <input name="lwd" defaultValue={sp.lwd ?? e.lastWorkingDay ?? ""} placeholder="31 August 2026" style={{ ...cfgInput, width: 140 }} /></label>
      <label>Notice (days) <input name="notice" type="number" defaultValue={sp.notice ?? ""} style={{ ...cfgInput, width: 70 }} /></label>
      <label>Letter date <input name="date" defaultValue={sp.date ?? ""} placeholder={todayDisplay()} style={{ ...cfgInput, width: 140 }} /></label>
      <input type="hidden" name="ref" value={sp.ref ?? ""} />
      <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Update</button>
    </form>
  );

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <>
          {configBar}
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "resignation-acceptance", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Acceptance of Resignation — ${e.name}` }}
          />
        </>
      }
    />
  );
}
