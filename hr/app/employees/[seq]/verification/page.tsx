import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildVerificationLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employment verification", robots: { index: false, follow: false } };

const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

export default async function GenerateVerification({
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
  const ref = sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`;
  const letter = buildVerificationLetter(e, {
    ref,
    date: today(),
    purpose: sp.purpose,
    to: sp.to ? { name: sp.to } : undefined,
    includeSalary: sp.salary !== "0",
  });

  // Options live in a visible no-print config bar (they were URL-only before —
  // undiscoverable). GET keeps the render server-side.
  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <label>Addressed to <input name="to" defaultValue={sp.to ?? ""} placeholder="To Whom It May Concern" style={{ ...cfgInput, minWidth: 180 }} /></label>
      <label>Purpose <input name="purpose" defaultValue={sp.purpose ?? ""} placeholder="e.g. a home-loan application" style={{ ...cfgInput, minWidth: 200 }} /></label>
      <label><input type="checkbox" name="salary" value="0" defaultChecked={sp.salary === "0"} /> Hide salary</label>
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
            save={{ seq, docType: "verification", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Employment Verification Letter — ${e.name}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
