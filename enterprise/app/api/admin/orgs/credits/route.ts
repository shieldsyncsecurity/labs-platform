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

  if (!orgId || typeof deltaNum !== "number" || !Number.isFinite(deltaNum) || deltaNum === 0) {
    return NextResponse.json(
      { error: "orgId and a non-zero numeric delta are required" },
      { status: 400 },
    );
  }

  try {
    const result = await entFetch("/ent/orgs/credits", {
      method: "POST",
      body: { orgId, delta: deltaNum },
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
