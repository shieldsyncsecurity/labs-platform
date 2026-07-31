import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildInternshipOffer } from "@/lib/documents/internship";
import type { Employee } from "@/lib/employee";
import { InternshipOfferDoc } from "@/components/InternshipOfferDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Internship offer", robots: { index: false, follow: false } };


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

  // Once a Letter of Intent has already been issued for this intern, this
  // generator page is a stale draft form — it starts over from the generic
  // template defaults and would silently drop every override that was
  // patched onto the real issued copy (address, hours, tiered notice, etc).
  // Send anyone who lands here straight to the actual issued document instead,
  // unless they explicitly ask for a fresh draft with ?fresh=1 (re-issuing a
  // second letter, e.g. after a genuine renegotiation).
  if (sp.fresh !== "1") {
    let generated: Array<{ docId: string; docType: string; generatedAt: string }> = [];
    try {
      generated = (await hrFetch<{ generated: typeof generated }>(`/hr/employees/${seq}/generated`)).generated ?? [];
    } catch { /* best-effort — fall through to the generator on failure */ }
    const issued = generated
      .filter((g) => g.docType === "internship-offer")
      .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))[0];
    if (issued) redirect(`/employees/${seq}/issued/${issued.docId}`);
  }

  const now = new Date();
  const ref = sp.ref ?? `SSS/INT/${now.getFullYear()}/•••`;
  // ?tieredNotice=1&probationMonths=1&probationNoticeDays=7&postNoticeMonths=1
  // — an explicit opt-in override; omitted entirely keeps the standard flat
  // fifteen (15) days' notice for everyone else.
  const tieredNotice =
    sp.tieredNotice === "1"
      ? {
          probationMonths: Number(sp.probationMonths) || 1,
          probationNoticeDays: Number(sp.probationNoticeDays) || 7,
          postNoticeMonths: Number(sp.postNoticeMonths) || 1,
        }
      : undefined;
  // ?hoursGlance=...&hoursBody=...&hoursStretchEnd=... — explicit opt-in
  // override; omitted entirely keeps the standard 12:00 noon – 8:00 PM hours.
  const hours = sp.hoursGlance && sp.hoursBody
    ? { glance: sp.hoursGlance, body: sp.hoursBody, stretchEnd: sp.hoursStretchEnd }
    : undefined;
  const offer = buildInternshipOffer(e, { ref, date: todayDisplay(), mentor: sp.mentor, tieredNotice, reportingTime: sp.reportingTime, hours });

  return (
    <InternshipOfferDoc
      offer={offer}
      toolbar={
        <>
          <div style={{ background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#7a5714", fontSize: 12.5, borderRadius: 8, padding: "9px 12px", marginBottom: 10, lineHeight: 1.5 }}>
            <b>Policy:</b> offers are collected in person at the office, not emailed. Print or save this letter for the candidate to
            sign and collect physically — use Email only if they genuinely cannot come in.
          </div>
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "internship-offer", title: "LETTER OF INTENT — INTERNSHIP", refSeries: "int", refYear: now.getFullYear(), snapshot: offer }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Your Letter of Intent — Internship — ShieldSync Security` }}
          />
        </>
      }
    />
  );
}
