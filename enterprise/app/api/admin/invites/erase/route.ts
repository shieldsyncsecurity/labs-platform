import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";

// ShieldSync-STAFF only: fulfil a candidate data-erasure request (DPDP / GDPR).
// Gated on getAdminSession() FIRST (this is a destructive, PII-affecting action);
// the engine redacts the candidate's identifiers + reflection in place. Never
// exposed to employers or candidates.
export async function POST(req: Request) {
  if (!(await getAdminSession())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: { inviteToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const inviteToken = body.inviteToken?.trim();
  if (!inviteToken) {
    return NextResponse.json({ error: "inviteToken is required" }, { status: 400 });
  }

  try {
    const r = await entFetch<{ ok?: boolean; erasedAt?: string }>("/ent/invites/erase", {
      method: "POST",
      body: { inviteToken, actor: "admin" },
    });
    return NextResponse.json(r);
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 404) {
      return NextResponse.json({ error: "No invite found for that token." }, { status: 404 });
    }
    console.error("[admin/invites/erase] failed", err);
    return NextResponse.json({ error: "Could not erase candidate data." }, { status: 502 });
  }
}
