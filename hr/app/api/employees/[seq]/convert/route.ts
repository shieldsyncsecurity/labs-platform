import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { suggestStructure } from "@/lib/payslip";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";

// Convert an intern to full-time: records the transition (the internship is
// history, not erased), keeps the SAME employee id, updates role + comp, and
// sets the joining date to the conversion date (full-time employment legally
// starts then; the internship tenure stays visible via the transition entry
// and the completion certificate). The fresh appointment letter is issued from
// the offer page afterwards (client redirects there).
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let body: { designation?: string; department?: string; grossMonthly?: number; annualCTC?: number; effectiveDate?: string; probationMonths?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const gross = Math.max(0, Math.round(Number(body.grossMonthly) || 0));
  const effectiveDate = (body.effectiveDate ?? "").trim();
  if (gross <= 0 || !effectiveDate) {
    return NextResponse.json({ error: "Full-time gross monthly and effective date are required." }, { status: 400 });
  }

  let e: Employee;
  try {
    e = (await hrFetch<{ employee: Employee }>(`/hr/employees/${encodeURIComponent(seq)}`)).employee;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the employee." }, { status: 502 });
  }
  if (!/internship/i.test(e.employmentType)) {
    return NextResponse.json({ error: "Only interns can be converted — this employee is already full-time." }, { status: 400 });
  }

  const designation = (body.designation ?? "").trim() || e.designation.replace(/intern/i, "Analyst");
  const transition = {
    from: `${e.employmentType} (${e.designation}, since ${e.dateOfJoining})`,
    to: `Full-time, permanent (${designation})`,
    effectiveDate,
    convertedBy: actor,
    convertedAt: new Date().toISOString(),
  };

  try {
    await hrFetch(`/hr/employees/${encodeURIComponent(seq)}`, {
      method: "PUT",
      body: {
        employee: {
          ...e,
          designation,
          department: (body.department ?? "").trim() || e.department,
          employmentType: "Full-time, permanent",
          dateOfJoining: effectiveDate,
          grossMonthly: gross,
          annualCTC: Math.max(0, Math.round(Number(body.annualCTC) || gross * 12)),
          structure: suggestStructure(gross),
          probationMonths: Number(body.probationMonths) > 0 ? Math.round(Number(body.probationMonths)) : 3,
          internshipMonths: undefined,
          transitions: [...(e.transitions ?? []), transition],
        },
        actor,
        expectedUpdatedAt: e.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 409) {
      return NextResponse.json({ error: "The record changed while you were editing — reload and retry." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not apply the conversion." }, { status: 502 });
  }

  try {
    await hrFetch("/hr/audit", {
      method: "POST",
      body: { actor, action: "employee.convert", target: e.employeeId, detail: { to: designation, effectiveDate } },
    });
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true });
}
