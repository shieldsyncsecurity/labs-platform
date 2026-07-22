import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildInternshipOffer } from "@/lib/documents/internship";
import type { Employee } from "@/lib/employee";
import { InternshipOfferDoc } from "@/components/InternshipOfferDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Internship offer", robots: { index: false, follow: false } };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

export default async function GenerateInternshipOffer({
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

  if (!/internship/i.test(e.employmentType)) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Internship offer letter</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name}&rsquo;s employment type is <b>{e.employmentType}</b>. The internship offer applies to
          employees whose type is <b>Internship</b> — for full-time roles use the appointment letter,
          or edit the record&rsquo;s employment type first.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  const now = new Date();
  const ref = sp.ref ?? `SSS/INT/${now.getFullYear()}/•••`;
  const offer = buildInternshipOffer(e, { ref, date: today(), mentor: sp.mentor });

  return (
    <InternshipOfferDoc
      offer={offer}
      toolbar={
        <DocToolbar
          backHref={`/employees/${seq}`}
          backLabel={e.name}
          save={{ seq, docType: "internship-offer", title: "INTERNSHIP OFFER LETTER", refSeries: "int", refYear: now.getFullYear(), snapshot: offer }}
          email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Your Internship Offer — ShieldSync Security` }}
        />
      }
    />
  );
}
