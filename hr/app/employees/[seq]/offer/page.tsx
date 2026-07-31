import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildOfferLetter, defaultDutiesFor } from "@/lib/documents/offer-letter";
import { DEFAULT_DUTIES, type Employee } from "@/lib/employee";
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

  const now = new Date();
  // Unified series: the REAL SSS/HR/<year>/NNN is allocated when the letter is
  // saved/printed (the toolbar reloads with ?ref=). Until then show a
  // provisional placeholder — page views never consume a number.
  const ref = sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`;
  const letter = buildOfferLetter({
    ref,
    date: todayDisplay(),
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
    structure: e.structure,
    probationMonths: e.probationMonths,
  });

  return (
    <OfferLetterDoc
      letter={letter}
      toolbar={
        <>
          <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", fontSize: 12.5, borderRadius: 8, padding: "9px 12px", marginBottom: 10, lineHeight: 1.5 }}>
            <b>Policy:</b> offers are collected in person at the office, not emailed. Print or save this letter for the candidate to
            sign and collect physically — use Email only if they genuinely cannot come in.
          </div>
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
