import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { normalizeEmployee } from "@/lib/employee";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;
  try {
    const data = await hrFetch(`/hr/employees/${encodeURIComponent(seq)}`);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load the employee." }, { status: 502 });
  }
}

// Update an employee (audited by the engine). employeeId + seq are immutable.
export async function PUT(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const employee = normalizeEmployee(body);
  if (!employee.name || !employee.designation || !employee.dateOfJoining) {
    return NextResponse.json({ error: "Name, designation, and date of joining are required." }, { status: 400 });
  }

  try {
    const data = await hrFetch(`/hr/employees/${encodeURIComponent(seq)}`, {
      method: "PUT",
      body: { employee, actor, expectedUpdatedAt: (body as { expectedUpdatedAt?: string }).expectedUpdatedAt },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    if (err instanceof HrEngineError && err.status === 409) {
      return NextResponse.json({ error: "The record changed while you were editing." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not update the employee." }, { status: 502 });
  }
}

// Delete an employee and cascade their KYC documents (S3 + metadata). Audited by
// the engine. Irreversible — the UI double-confirms.
export async function DELETE(_req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;
  try {
    const data = await hrFetch(`/hr/employees/${encodeURIComponent(seq)}`, { method: "DELETE", body: { actor } });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not delete the employee." }, { status: 502 });
  }
}
