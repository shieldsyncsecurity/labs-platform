import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import type { BankTxn } from "@/lib/banking";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const month = new URL(req.url).searchParams.get("month") ?? undefined;
  try {
    const out = await hrFetch<{ transactions: BankTxn[] }>("/hr/banking", { query: month ? { month } : undefined });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "Could not reach the HR data service." }, { status: 502 });
  }
}

/** Commit reviewed transactions. Idempotent — deterministic txnIds mean a
 * re-import of an overlapping period updates rows instead of double-counting. */
export async function POST(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { transactions?: BankTxn[]; accountNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const transactions = body.transactions ?? [];
  if (!transactions.length) return NextResponse.json({ error: "Nothing to import." }, { status: 400 });

  try {
    const out = await hrFetch<{ created: number; updated: number }>("/hr/banking", {
      method: "POST",
      body: { transactions, accountNumber: body.accountNumber, actor },
      timeoutMs: 60000,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch {
    return NextResponse.json({ error: "Could not save the transactions." }, { status: 502 });
  }
}
