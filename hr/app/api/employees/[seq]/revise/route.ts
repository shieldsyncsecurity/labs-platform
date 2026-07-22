import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { suggestStructure } from "@/lib/payslip";
import { buildIncrementLetter } from "@/lib/documents/letters";
import type { CompRevision, Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";

function today(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

// Salary revision: one atomic flow — append the current comp to the revision
// history, apply the new comp, and issue the increment letter (unified HR ref).
// Returns the issued letter's genId for redirect.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let body: { grossMonthly?: number; annualCTC?: number; effectiveDate?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const newGross = Math.max(0, Math.round(Number(body.grossMonthly) || 0));
  const effectiveDate = (body.effectiveDate ?? "").trim();
  if (newGross <= 0 || !effectiveDate) {
    return NextResponse.json({ error: "New gross monthly and effective date are required." }, { status: 400 });
  }

  // Load the current record (old comp becomes the history entry).
  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${encodeURIComponent(seq)}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the employee." }, { status: 502 });
  }
  if (newGross === e.grossMonthly) {
    return NextResponse.json({ error: "New gross equals the current gross — nothing to revise." }, { status: 400 });
  }

  const newAnnualCTC = Math.max(0, Math.round(Number(body.annualCTC) || newGross * 12));
  const newStructure = suggestStructure(newGross);
  const revision: CompRevision = {
    effectiveDate,
    grossMonthly: e.grossMonthly,
    annualCTC: e.annualCTC,
    structure: e.structure,
    reason: (body.reason ?? "").trim() || "Salary revision",
    revisedBy: actor,
    revisedAt: new Date().toISOString(),
  };

  // 1) Apply the new comp + append history (status/LWD preserved by the engine).
  try {
    await hrFetch(`/hr/employees/${encodeURIComponent(seq)}`, {
      method: "PUT",
      body: {
        employee: {
          ...e,
          grossMonthly: newGross,
          annualCTC: newAnnualCTC,
          structure: newStructure,
          revisions: [...(e.revisions ?? []), revision],
        },
        actor,
        expectedUpdatedAt: e.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 409) {
      return NextResponse.json({ error: "The record changed while you were editing — reload and retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not apply the revision." }, { status: 502 });
  }

  // 2) Issue the increment letter into history (real SSS/HR ref allocated here).
  const letter = buildIncrementLetter(
    { ...e, grossMonthly: newGross, annualCTC: newAnnualCTC, structure: newStructure },
    {
      ref: "", // allocated by the engine (refSeries "hr")
      date: today(),
      effectiveDate,
      oldStructure: e.structure,
      newStructure,
      newAnnualCTC,
      reason: (body.reason ?? "").trim() || undefined,
    },
  );
  try {
    const gen = await hrFetch<{ gen?: { docId?: string; ref?: string } }>(
      `/hr/employees/${encodeURIComponent(seq)}/generated`,
      {
        method: "POST",
        timeoutMs: 30000,
        body: {
          docType: "increment",
          title: "SALARY REVISION LETTER",
          refSeries: "hr",
          refYear: new Date().getFullYear(),
          snapshot: letter,
          actor,
        },
      },
    );
    return NextResponse.json({ ok: true, genId: gen.gen?.docId, ref: gen.gen?.ref });
  } catch {
    // Comp is applied; the letter can be re-issued from the employee page.
    return NextResponse.json({ ok: true, genId: null, warning: "Revision applied, but the letter could not be saved — re-issue it from the employee page." });
  }
}
