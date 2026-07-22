import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import { normalizeEmployee } from "@/lib/employee";

export const dynamic = "force-dynamic";

// List employees. Self-gates (middleware lets /api/* through to return JSON).
export async function GET() {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const data = await hrFetch<{ employees?: unknown[] }>("/hr/employees");
    return NextResponse.json({ employees: data.employees ?? [] });
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
  if (employee.grossMonthly <= 0) {
    return NextResponse.json({ error: "Gross monthly salary must be greater than zero." }, { status: 400 });
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
