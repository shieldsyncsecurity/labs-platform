import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildCompletionCertificate } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificate of completion", robots: { index: false, follow: false } };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

// Internship completion certificate — needs an internship engagement that has
// ENDED (status exited + last working day), mirroring the experience letter's gate.
export default async function GenerateCompletion({
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

  if (!/internship/i.test(e.employmentType) || e.status !== "exited" || !e.lastWorkingDay) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Certificate of completion</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          The certificate applies to <b>Internship</b> engagements that have <b>ended</b> — the intern
          must be marked exited with a last working day (their internship end date) on their page.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  const now = new Date();
  const ref = sp.ref ?? `SSS/INT/${now.getFullYear()}/•••`;
  const letter = buildCompletionCertificate(e, {
    ref,
    date: today(),
    fromDate: e.dateOfJoining,
    toDate: e.lastWorkingDay,
    project: (sp.project ?? "").trim() || undefined,
  });

  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <label>
        Project (optional){" "}
        <input name="project" defaultValue={sp.project ?? ""} placeholder="e.g. an AWS S3 security-audit lab" style={{ padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6, minWidth: 260 }} />
      </label>
      <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Update</button>
    </form>
  );

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <>
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "completion", title: letter.title, refSeries: "int", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Certificate of Completion — ${e.name}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
