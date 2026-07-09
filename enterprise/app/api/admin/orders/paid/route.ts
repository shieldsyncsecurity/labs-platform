import { NextResponse } from "next/server";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { getAdminActor } from "@/lib/server/admin-session";

// Engine response wrapper for POST /ent/orders/paid (Wave 1 as-built shape):
// { paid: { paid, creditsGranted?, orgMissing?, notFound? } }. Only the FIRST
// successful call grants credits (atomic created->paid CAS + ADD); retries get
// paid:false with nothing granted.
type PaidResponse = {
  paid?: {
    paid?: boolean;
    creditsGranted?: number;
    orgMissing?: boolean;
    notFound?: boolean;
  };
};

// Staff-only: mark a recorded order as paid, which atomically grants the
// order's credits to the org (E4 money loop, exactly-once on the engine).
// getAdminActor() is the fail-closed gate (null = no valid admin session)
// and the E9 audit identity forwarded to the engine's audit line.
export async function POST(req: Request) {
  const actor = await getAdminActor();
  if (!actor) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const orderId = body.orderId?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  try {
    const res = await entFetch<PaidResponse>("/ent/orders/paid", {
      method: "POST",
      body: { orderId, actor },
    });
    const paid = res?.paid ?? {};
    if (paid.notFound) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    if (paid.orgMissing) {
      // The org row was deleted after the order was recorded: the engine
      // cancelled the whole transaction, so the order stays "created" and no
      // credits were granted. Surface it -- this order needs manual attention.
      return NextResponse.json(
        {
          error:
            "This order's organization no longer exists, so no credits were granted. The order stays unpaid for investigation.",
        },
        { status: 409 },
      );
    }
    if (!paid.paid) {
      // Lost the created->paid CAS: someone already marked it paid. Nothing
      // was double-granted; tell the client so it just refreshes.
      return NextResponse.json({ ok: true, alreadyPaid: true, creditsGranted: 0 });
    }
    return NextResponse.json({ ok: true, creditsGranted: paid.creditsGranted ?? 0 });
  } catch (err) {
    if (err instanceof EntEngineError) {
      return NextResponse.json(
        { error: "Could not mark the order paid.", detail: err.body },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Could not mark the order paid." }, { status: 502 });
  }
}
