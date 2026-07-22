import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildConfirmationLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmation letter", robots: { index: false, follow: false } };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}
function disp(iso: string): string {
  const [y, m, dd] = iso.split("-").map(Number);
  if (!y || !m || !dd) return "";
  return `${dd} ${new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" })} ${y}`;
}
/** Default confirmation date = joining + probationMonths. */
function defaultConfirmation(e: Employee): string {
  const joined = new Date(e.dateOfJoining);
  if (Number.isNaN(joined.getTime())) return "";
  joined.setMonth(joined.getMonth() + (e.probationMonths ?? 3));
  return `${joined.getDate()} ${joined.toLocaleString("en-GB", { month: "long" })} ${joined.getFullYear()}`;
}

export default async function GenerateConfirmation({
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
  const confirmationDate = sp.cd ? disp(sp.cd) : defaultConfirmation(e) || today();
  const letter = buildConfirmationLetter(e, { ref, date: today(), confirmationDate });

  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <label>
        Confirmation effective date{" "}
        <input type="date" name="cd" defaultValue={sp.cd ?? ""} style={{ padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 }} />
      </label>
      <span style={{ color: "#8a94a3", fontSize: 11.5 }}>Blank = joining date + {e.probationMonths ?? 3} months ({defaultConfirmation(e) || "—"})</span>
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
            save={{ seq, docType: "confirmation", title: letter.title, refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Confirmation of Employment — ${e.name}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
