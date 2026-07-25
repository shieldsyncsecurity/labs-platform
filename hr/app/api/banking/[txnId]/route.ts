import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import type { BankTxn } from "@/lib/banking";

export const dynamic = "force-dynamic";

/** Reclassify or annotate one transaction. Marks it user-set so a later
 * statement re-import can't silently revert the correction. */
export async function PUT(req: Request, { params }: { params: Promise<{ txnId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { txnId } = await params;

  let body: { category?: string; note?: string; matchedEmployeeSeq?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const out = await hrFetch<{ transaction: BankTxn }>(`/hr/banking/${encodeURIComponent(txnId)}`, {
      method: "PUT",
      body: { ...body, actor },
    });
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not update the transaction." }, { status: 502 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ txnId: string }> }) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { txnId } = await params;
  try {
    await hrFetch(`/hr/banking/${encodeURIComponent(txnId)}`, { method: "DELETE", body: { actor } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not delete the transaction." }, { status: 502 });
  }
}
