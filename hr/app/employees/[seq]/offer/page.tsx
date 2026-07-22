import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildOfferLetter } from "@/lib/documents/offer-letter";
import { DEFAULT_DUTIES, type Employee } from "@/lib/employee";
import { OfferLetterDoc } from "@/components/OfferLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Appointment letter", robots: { index: false, follow: false } };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

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
    date: today(),
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
    duties: e.duties.length ? e.duties : DEFAULT_DUTIES,
    structure: e.structure,
    probationMonths: e.probationMonths,
  });

  return (
    <OfferLetterDoc
      letter={letter}
      toolbar={
        <DocToolbar
          backHref={`/employees/${seq}`}
          backLabel={e.name}
          save={{ seq, docType: "offer", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
          email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Your Letter of Appointment — ShieldSync Security` }}
        />
      }
    />
  );
}
