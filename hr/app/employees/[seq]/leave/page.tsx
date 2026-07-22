import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { buildLeaveLetter } from "@/lib/documents/letters";
import type { Employee } from "@/lib/employee";
import { SimpleLetterDoc } from "@/components/SimpleLetterDoc";
import { DocToolbar } from "@/components/DocToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leave approval letter", robots: { index: false, follow: false } };

const cfgInput: React.CSSProperties = { padding: "6px 8px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "long" })} ${d.getFullYear()}`;
}
function disp(iso: string): string {
  const [y, m, dd] = iso.split("-").map(Number);
  if (!y || !m || !dd) return "";
  return `${String(dd).padStart(2, "0")} ${new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" })} ${y}`;
}
function daysInclusive(fromIso: string, toIso: string): number {
  const a = new Date(fromIso), b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}
function nextDay(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Leave approval / NOC letter (the signed Diya original is the template).
export default async function GenerateLeave({
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

  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && daysInclusive(from, to) > 0;

  const configBar = (
    <form method="get" style={{ marginTop: 8, border: "1px solid #e2e8f2", borderRadius: 10, padding: "10px 12px", background: "#fff", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
      <label>From <input type="date" name="from" required defaultValue={from} style={cfgInput} /></label>
      <label>To <input type="date" name="to" required defaultValue={to} style={cfgInput} /></label>
      <label>Purpose <input name="purpose" defaultValue={sp.purpose ?? ""} placeholder="Personal travel / tourism" style={{ ...cfgInput, minWidth: 200 }} /></label>
      <label><input type="checkbox" name="unpaid" value="1" defaultChecked={sp.unpaid === "1"} /> Unpaid</label>
      <label>Addressee note <input name="toNote" defaultValue={sp.toNote ?? ""} placeholder="(Addressed to the Visa Officer / Consular Authority)" style={{ ...cfgInput, minWidth: 240 }} /></label>
      <label>In support of <input name="support" defaultValue={sp.support ?? ""} placeholder="a Schengen visa application" style={{ ...cfgInput, minWidth: 180 }} /></label>
      <button type="submit" style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Update</button>
    </form>
  );

  if (!ready) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, sans-serif" }}>
        <Link href={`/employees/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {e.name}</Link>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Leave approval letter</h1>
        <p style={{ fontSize: 12.5, color: "#5b6676" }}>Pick the leave dates (and optional purpose/addressee) to generate the letter.</p>
        {configBar}
      </main>
    );
  }

  const now = new Date();
  const ref = sp.ref ?? `SSS/HR/${now.getFullYear()}/•••`;
  const letter = buildLeaveLetter(e, {
    ref,
    date: today(),
    leaveFrom: disp(from),
    leaveTo: disp(to),
    totalDays: daysInclusive(from, to),
    purpose: (sp.purpose ?? "").trim() || "Personal leave",
    resumeDate: disp(nextDay(to)),
    paid: sp.unpaid !== "1",
    toNote: (sp.toNote ?? "").trim() || undefined,
    supportPurpose: (sp.support ?? "").trim() || undefined,
  });

  return (
    <SimpleLetterDoc
      letter={letter}
      toolbar={
        <>
          <DocToolbar
            backHref={`/employees/${seq}`}
            backLabel={e.name}
            save={{ seq, docType: "leave", title: "APPROVED LEAVE OF ABSENCE", refSeries: "hr", refYear: now.getFullYear(), snapshot: letter }}
            email={{ seq, defaultTo: e.personalEmail, defaultSubject: `Leave Approval Letter — ${e.name}` }}
          />
          {configBar}
        </>
      }
    />
  );
}
