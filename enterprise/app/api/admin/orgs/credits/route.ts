import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

type AdjustCreditsBody = {
  orgId?: string;
  delta?: number | string;
  reason?: string;
};

// Staff-only: adjust an org's credit balance (delta can be negative). EVERY
// route under app/api/admin/* must verify the admin session FIRST;
// getAdminActor() doubles as that fail-closed gate (null = no valid session)
// AND the E9 audit identity (staff email, or "secret-admin" for the legacy
// shared-secret login) forwarded to the engine's audit line.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: AdjustCreditsBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId?.trim();
  const deltaNum = typeof body.delta === "string" ? Number(body.delta) : body.delta;

  // Credits are whole units: require a non-zero INTEGER and clamp the
  // magnitude so a typo/abuse can't swing a balance by an absurd amount.
  const MAX_DELTA = 1_000_000;
  if (
    !orgId ||
    typeof deltaNum !== "number" ||
    !Number.isInteger(deltaNum) ||
    deltaNum === 0 ||
    Math.abs(deltaNum) > MAX_DELTA
  ) {
    return NextResponse.json(
      { error: "orgId and a non-zero integer delta within +/-1000000 are required" },
      { status: 400 },
    );
  }

  // Optional free-text reason for the engine's audit line (E9); the engine
  // clamps to 300 chars, mirror that here.
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  try {
    const result = await entFetch("/ent/orgs/credits", {
      method: "POST",
      body: { orgId, delta: deltaNum, actor, ...(reason ? { reason } : {}) },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not adjust credits.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not adjust credits." }, { status: 502 });
  }
}
