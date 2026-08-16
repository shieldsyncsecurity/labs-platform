import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { todayDisplay } from "@/lib/dates";
import { buildExperienceLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Experience / relieving letter", robots: { index: false, follow: false } };


export default async function GenerateExperience({
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

  // Intern gate: buildExperienceLetter always states "was employed with...",
  // which directly contradicts the internship offer's own clause ("This is an
  // internship and not an offer of employment. It does not create an
  // employer-employee relationship..."). An exited intern's document is the
  // completion certificate instead — mirrors completion/page.tsx's own
  // opposite check.
  if (/internship/i.test(e.employmentType)) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Experience / relieving letter</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name}&rsquo;s employment type is <b>{e.employmentType}</b>. This letter states &ldquo;was employed&rdquo;,
          which applies to full-time roles — for an internship use the completion certificate instead,
          which correctly describes the engagement.
        </p>
        <Link href={`/employees/${seq}/completion`} style={{ color: "#2f4fb0", fontSize: 13 }}>Go to completion certificate &rarr;</Link>
        <br />
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  if (e.status !== "exited" || !e.lastWorkingDay) {
    return (
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>Experience / relieving letter</h1>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
          {e.name} is still <b>active</b>. Mark them <b>exited</b> with a last working day (on their page) to issue an
          experience/relieving letter.
        </p>
        <Link href={`/employees/${seq}`} style={{ color: "#2f4fb0", fontSize: 13 }}>&larr; Back to {e.name}</Link>
      </main>
    );
  }

  const now = new Date();
  const letter = buildExperienceLetter(e, {
    ref: sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`,
    date: sp.date?.trim() || todayDisplay(),
  });

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <DocToolbar
          backHref={`/employees/${seq}`}
          backLabel={e.name}
          save={{ seq, docType: "experience", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
          email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Experience / Relieving Letter — ${e.name}` }}
        />
      }
    />
  );
}
