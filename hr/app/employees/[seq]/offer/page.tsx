import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildOfferLetter, defaultDutiesFor } from "@/lib/documents/offer-letter";
import { DEFAULT_DUTIES, type Employee } from "@/lib/employee";
import { suggestStructure } from "@/lib/payslip";
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appointment letter", robots: { index: false, follow: false } };


export default async function GenerateOffer({
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

  // The internship offer (Letter of Intent) is the correct document for an
  // intern — this generator's probation/PF/ESI/non-solicit/30-day-notice
  // clauses don't apply to an internship and would contradict that letter if
  // both exist on the same record. Reciprocal to internship-offer/page.tsx's
  // own opposite check.
  if (/internship/i.test(e.employmentType)) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Appointment letter</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name}&rsquo;s employment type is <b>{e.employmentType}</b>. The appointment letter applies to
          full-time roles — for an internship use the internship offer (Letter of Intent),
          or edit the record&rsquo;s employment type first.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  const now = new Date();
  // Unified series: the REAL SSS/HR/<year>/NNN is allocated when the letter is
  // saved/printed (the toolbar reloads with ?ref=). Until then show a
  // provisional placeholder — page views never consume a number.
  const ref = sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`;
  // Retrospective issue: `?date=` stamps a historical letter date (e.g. the real
  // joining date when formalising a prior verbal engagement) instead of today.
  // In that mode the "collect original in person" watermark and policy note don't
  // apply — the person has already been working — so both are dropped.
  const retro = !!sp.date?.trim();
  const letter = buildOfferLetter({
    ref,
    date: sp.date?.trim() || todayDisplay(),
    noWatermark: retro,
    employee: {
      name: e.name,
      address: e.address,
      designation: e.designation,
      department: e.department,
      dateOfJoining: e.dateOfJoining,
      employmentType: e.employmentType,
      annualCTC: e.annualCTC,
      grossMonthly: e.grossMonthly,
      baseLocation: e.baseLocation,
      reportingTo: e.reportingTo,
    },
    duties: e.duties.length ? e.duties : (defaultDutiesFor(e.designation) ?? DEFAULT_DUTIES),
    // Older/imported records can lack a stored structure — fall back rather
    // than crashing on e.structure.basic (the same class of bug fixed on the
    // employee record page and in structureForMonth()).
    structure: e.structure ?? suggestStructure(e.grossMonthly),
    probationMonths: e.probationMonths,
  });

  return (
    <OfferLetterDoc
      letter={letter}
      toolbar={
        <>
          {retro ? (
            <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", fontSize: 12.5, borderRadius: 8, padding: "9px 12px", marginBottom: 10, lineHeight: 1.5 }}>
              <b>Retrospective letter:</b> dated {sp.date?.trim()} (not today). Issued to formalise a prior engagement — the in-person collection watermark is omitted.
            </div>
          ) : (
            <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", fontSize: 12.5, borderRadius: 8, padding: "9px 12px", marginBottom: 10, lineHeight: 1.5 }}>
              <b>Policy:</b> offers are collected in person at the office, not emailed. Print or save this letter for the candidate to
              sign and collect physically — use Email only if they genuinely cannot come in.
            </div>
          )}
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "offer", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Your Letter of Appointment — ShieldSync Security` }}
          />
        </>
      }
    />
  );
}
