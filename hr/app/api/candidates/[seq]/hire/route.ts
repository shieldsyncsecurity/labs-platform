import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { normalizeEmployee, allowsZeroGross, type Employee } from "@/lib/employee";
import type { Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";

// Hire: turn a candidate into an employee record, keeping the hiring record as
// the evidence trail (candidate -> outcome "hired" + the employee id it became).
// The candidate row is NOT deleted: it holds the questionnaire the person
// consented to give during recruitment, and it's what proves how they were hired.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Hiring MINTS an employee record and writes its pay, so it needs the same
  // permission the /api/employees POST enforces — not just candidates:write.
  // The middleware only checks the latter (access-routes.ts gates /hire on
  // candidates:write), so without this a recruiter who can't create employees
  // or see salary could create one AND set their salary through this route.
  const { isAdmin, access } = await getViewer();
  if (!(isAdmin || (can(access, "employees", "write") && access.seeSalary))) {
    return NextResponse.json({ error: "You do not have permission to create employee records." }, { status: 403 });
  }

  const { seq } = await params;

  let input: Partial<Employee>;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let candidate: Candidate;
  try {
    candidate = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${encodeURIComponent(seq)}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not load the candidate." }, { status: 502 });
  }
  if (candidate.convertedSeq) {
    return NextResponse.json({ error: `Already hired as ${candidate.convertedEmployeeId}.`, seq: candidate.convertedSeq }, { status: 409 });
  }

  const employee = normalizeEmployee({
    ...input,
    name: input.name || candidate.name,
    personalEmail: input.personalEmail || candidate.email,
    phone: input.phone || candidate.phone,
  });
  if (!employee.name || !employee.designation || !employee.dateOfJoining) {
    return NextResponse.json({ error: "Name, designation and date of joining are required." }, { status: 400 });
  }
  if (employee.grossMonthly <= 0 && !allowsZeroGross(employee.employmentType)) {
    return NextResponse.json(
      { error: "Gross monthly salary must be greater than zero (0 is allowed only for internships and consultants, who have no fixed monthly salary)." },
      { status: 400 },
    );
  }

  let created: Employee;
  try {
    created = (await hrFetch<{ employee: Employee }>("/hr/employees", { method: "POST", body: { employee, actor } })).employee;
  } catch {
    return NextResponse.json({ error: "Could not create the employee record." }, { status: 502 });
  }

  // Link the hiring record to the employee it became.
  try {
    await hrFetch(`/hr/candidates/${encodeURIComponent(seq)}`, {
      method: "PUT",
      body: {
        candidate: { ...candidate, outcome: "hired", convertedEmployeeId: created.employeeId, convertedSeq: created.seq },
        actor,
      },
    });
  } catch {
    // The employee EXISTS — never report failure here or the user will hire twice.
    return NextResponse.json({
      ok: true,
      seq: created.seq,
      employeeId: created.employeeId,
      warning: "Employee created, but the candidate record could not be marked as hired — set it manually.",
    });
  }

  try {
    await hrFetch("/hr/audit", {
      method: "POST",
      body: { actor, action: "candidate.hire", target: candidate.candidateId, detail: { employeeId: created.employeeId } },
    });
  } catch {
    /* best-effort */
  }

  // The client uses this to send an intern to the internship-offer letter
  // rather than the standard appointment letter.
  const isInternship = /internship/i.test(created.employmentType ?? "");
  return NextResponse.json({ ok: true, seq: created.seq, employeeId: created.employeeId, isInternship });
}
