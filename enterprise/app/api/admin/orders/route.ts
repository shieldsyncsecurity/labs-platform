import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

type CreateOrderBody = {
  orgId?: string;
  credits?: number | string;
  invoiceNo?: string;
  note?: string;
};

// Staff-only: record a credit-purchase order (offline GST invoice) against an
// org on the enterprise engine. The order starts "created" and grants NOTHING
// until /api/admin/orders/paid flips it -- the engine's created->paid CAS is
// what adds the credits, exactly once. EVERY route under app/api/admin/* must
// verify the admin session FIRST; getAdminActor() doubles as that fail-closed
// gate (null = no valid session) AND the E9 audit identity.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orgId = body.orgId?.trim();
  const creditsNum = typeof body.credits === "string" ? Number(body.credits) : body.credits;

  // Credits are whole units; clamp so a typo can't record an absurd order.
  const MAX_CREDITS = 10_000;
  if (
    !orgId ||
    typeof creditsNum !== "number" ||
    !Number.isInteger(creditsNum) ||
    creditsNum <= 0 ||
    creditsNum > MAX_CREDITS
  ) {
    return NextResponse.json(
      { error: "orgId and a positive integer credits value (max 10000) are required" },
      { status: 400 },
    );
  }

  const invoiceNo = (body.invoiceNo ?? "").trim().slice(0, 64) || undefined;
  const note = (body.note ?? "").trim().slice(0, 300) || undefined;

  try {
    const order = await entFetch<{ orderId?: string }>("/ent/orders", {
      method: "POST",
      body: { orgId, credits: creditsNum, invoiceNo, note, actor },
    });
    // The engine has no audit line on order creation yet, so emit the
    // attributable record here (Worker logs) -- same greppable shape as the
    // engine's own audit lines.
    console.log(
      JSON.stringify({
        audit: true,
        action: "order.create",
        actor,
        orgId,
        orderId: order?.orderId ?? null,
        credits: creditsNum,
        invoiceNo: invoiceNo ?? null,
        note: note ?? null,
        at: Date.now(),
      }),
    );
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not record the order.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not record the order." }, { status: 502 });
  }
}
