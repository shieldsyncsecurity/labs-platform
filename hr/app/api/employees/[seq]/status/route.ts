import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Offboard (status=exited + last working day) or reactivate. Distinct audit
// event; only these two fields change (partial merge in the engine).
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  let body: { status?: string; lastWorkingDay?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const status = body.status === "exited" ? "exited" : "active";
  const lastWorkingDay = typeof body.lastWorkingDay === "string" ? body.lastWorkingDay.trim() : "";
  if (status === "exited" && !lastWorkingDay) {
    return NextResponse.json({ error: "Last working day is required to mark an employee exited." }, { status: 400 });
  }

  try {
    const data = await hrFetch(`/hr/employees/${encodeURIComponent(seq)}/status`, {
      method: "POST",
      body: { status, lastWorkingDay, actor },
    });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not update status." }, { status: 502 });
  }
}
