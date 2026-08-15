import { NextResponse } from "next/server";
import { guardAdminApi } from "@/lib/server/hr-access";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

/** Mark an employee record administrator-only (or visible again). Admin only —
 * a person must never be able to change the visibility of their own gate. */
export async function PUT(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const { seq } = await params;

  let body: { restricted?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const actor = await getHrActor();
    const data = await hrFetch("/hr/restricted", {
      method: "PUT",
      body: { seq: Number(seq), restricted: body.restricted === true, actor },
    });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Could not update visibility." }, { status: 502 });
  }
}
