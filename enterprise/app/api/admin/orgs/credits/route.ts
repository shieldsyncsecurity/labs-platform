import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminSession } from "@/lib/server/admin-session";

type AdjustCreditsBody = {
  orgId?: string;
  delta?: number | string;
};

// Staff-only: adjust an org's credit balance (delta can be negative). EVERY
// route under app/api/admin/* must call getAdminSession() first.
export async function POST(req: Request) {
  const isAdmin = await getAdminSession();
  if (!isAdmin) {
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

  // getAdminSession() only returns a boolean (no identity), so the best-effort
  // actor for the engine's audit trail is a constant marker.
  const actor = "admin";

  try {
    const result = await entFetch("/ent/orgs/credits", {
      method: "POST",
      body: { orgId, delta: deltaNum, actor },
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
