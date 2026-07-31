import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildEmploymentHistoryLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employment history certificate", robots: { index: false, follow: false } };

const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };

// Multi-phase engagement (e.g. unpaid internship converting into paid
// employment) isn't derivable from a single employee record, so — same
// convention as the leave-letter page — the phase details come from a config
// bar with sensible defaults, not from parsing free text on the record.
export default async function GenerateEmploymentHistory({
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

  if (e.status !== "exited" || !e.lastWorkingDay) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Employment history certificate</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name} is still <b>active</b>. Mark them <b>exited</b> with a last working day (on their page) first.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  const fields = {
    p1From: sp.p1From ?? e.dateOfJoining,
    p1To: sp.p1To ?? "",
    p1Designation: sp.p1Designation ?? "",
    p1Engagement: sp.p1Engagement ?? "Internship (unpaid)",
    p2From: sp.p2From ?? "",
    p2To: sp.p2To ?? e.lastWorkingDay,
    p2Designation: sp.p2Designation ?? e.designation,
    p2Engagement: sp.p2Engagement ?? "Full-time employment",
    salaryNote: sp.salaryNote ?? "",
    notice: sp.notice ?? "",
  };
  const ready = Boolean(fields.p1To && fields.p1Designation && fields.p2From);

  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <b style={{ width: "100%", fontSize: 11, color: "#5b6676" }}>Phase 1</b>
      <label>From <input name="p1From" defaultValue={fields.p1From} style={{ ...cfgInput, width: 130 }} /></label>
      <label>To <input name="p1To" defaultValue={fields.p1To} placeholder="30 November 2025" style={{ ...cfgInput, width: 130 }} /></label>
      <label>Designation <input name="p1Designation" defaultValue={fields.p1Designation} placeholder="Cloud Security Intern" style={{ ...cfgInput, width: 170 }} /></label>
      <label>Engagement <input name="p1Engagement" defaultValue={fields.p1Engagement} style={{ ...cfgInput, width: 160 }} /></label>
      <b style={{ width: "100%", fontSize: 11, color: "#5b6676", marginTop: 4 }}>Phase 2</b>
      <label>From <input name="p2From" defaultValue={fields.p2From} placeholder="1 December 2025" style={{ ...cfgInput, width: 130 }} /></label>
      <label>To <input name="p2To" defaultValue={fields.p2To} style={{ ...cfgInput, width: 130 }} /></label>
      <label>Designation <input name="p2Designation" defaultValue={fields.p2Designation} style={{ ...cfgInput, width: 170 }} /></label>
      <label>Engagement <input name="p2Engagement" defaultValue={fields.p2Engagement} style={{ ...cfgInput, width: 160 }} /></label>
      <label>Salary note <input name="salaryNote" defaultValue={fields.salaryNote} placeholder="a monthly salary of INR 30,000 (Rupees Thirty Thousand only)" style={{ ...cfgInput, minWidth: 320 }} /></label>
      <label>Notice served (days) <input name="notice" type="number" defaultValue={fields.notice} style={{ ...cfgInput, width: 70 }} /></label>
      <label>Document date <input name="date" defaultValue={sp.date ?? ""} placeholder={todayDisplay()} style={{ ...cfgInput, width: 150 }} /></label>
      <input type="hidden" name="ref" value={sp.ref ?? ""} />
      <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Update</button>
    </form>
  );

  if (!ready) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, sans-serif" }}>
        <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Employment history certificate</h1>
        <p style={{ fontSize: 12.5, color: "#5b6676" }}>Fill in both phases to generate the certificate.</p>
        {configBar}
      </main>
    );
  }

  const now = new Date();
  const ref = sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`;
  const letter = buildEmploymentHistoryLetter(e, {
    ref,
    date: sp.date?.trim() || todayDisplay(),
    phases: [
      { from: fields.p1From, to: fields.p1To, designation: fields.p1Designation, engagement: fields.p1Engagement },
      { from: fields.p2From, to: fields.p2To, designation: fields.p2Designation, engagement: fields.p2Engagement },
    ],
    salaryNote: fields.salaryNote || undefined,
    noticeDays: Number(fields.notice) > 0 ? Number(fields.notice) : undefined,
  });

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <>
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "employment-history", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Employment History Certificate — ${e.name}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
