import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { guardAdminApi } from "@/lib/server/hr-access";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";

// Admin-only: (re)issues a fresh 6-digit self-serve PIN for one employee.
// The PIN is returned in this ONE response and never stored anywhere on the
// Next.js side — only its salted hash reaches the engine. If the admin
// navigates away without copying it, the only recovery is issuing a new one.
//
// The guard below is not belt-and-braces, it is THE gate: this path inherits
// the generic /api/employees mapping (employees:write), so without it anyone
// who can edit an employee could mint that person's self-serve PIN, sign in as
// them at /my/login, and read the documents and pay figures their own
// permissions deny them. Minting a login credential is an owner action.
export async function POST(req: Request, { params }: { params: Promise<{ seq: string }> }) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { seq } = await params;

  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  try {
    await hrFetch(`/hr/employees/${encodeURIComponent(seq)}/self-pin`, {
      method: "POST",
      body: { pin, actor },
    });
    return NextResponse.json({ pin });
  } catch {
    return NextResponse.json({ error: "Could not set the PIN." }, { status: 502 });
  }
}
