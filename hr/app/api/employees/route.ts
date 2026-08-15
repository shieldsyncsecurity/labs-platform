import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { getViewer } from "@/lib/server/hr-access";
import { visibleProjectedEmployees } from "@/lib/server/employee-view";
import { hrFetch } from "@/lib/server/hr-engine";
import { normalizeEmployee, allowsZeroGross, type Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";

// List employees. Self-gates (middleware lets /api/* through to return JSON).
//
// The response is PROJECTED for the caller — administrator-only records are
// dropped and salary/bank fields stripped unless they hold those permissions.
// Returning the raw engine payload here would have made every field mask on
// /employees decorative: same data, one tab over, no permission needed.
export async function GET() {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const viewer = await getViewer();
    const data = await hrFetch<{ employees?: Employee[] }>("/hr/employees");
    return NextResponse.json({ employees: await visibleProjectedEmployees(data.employees ?? [], viewer) });
  } catch {
    return NextResponse.json({ error: "Could not load employees." }, { status: 502 });
  }
}

// Create an employee. The engine assigns the id (SSS/EMP/NNNN) + timestamps and
// writes an audit event with the actor.
export async function POST(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const employee = normalizeEmployee(body);
  if (!employee.name || !employee.designation || !employee.dateOfJoining) {
    return NextResponse.json(
      { error: "Name, designation, and date of joining are required." },
      { status: 400 },
    );
  }
  // Unpaid internships are legitimate (the internship offer explicitly renders
  // "no stipend payable" at 0) — only paid roles require a positive gross.
  if (employee.grossMonthly <= 0 && !allowsZeroGross(employee.employmentType)) {
    return NextResponse.json(
      { error: "Gross monthly salary must be greater than zero (0 is allowed only for internships and consultants, who have no fixed monthly salary)." },
      { status: 400 },
    );
  }

  try {
    const data = await hrFetch<{ employee?: unknown }>("/hr/employees", {
      method: "POST",
      body: { employee, actor },
    });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not create the employee." }, { status: 502 });
  }
}
