import { NextResponse } from "next/server";
import { getHrActor } from "@/lib/server/hr-session";
import { hrFetch } from "@/lib/server/hr-engine";
import { parseIdfcStatement, categorise, type RosterEntry, type BankTxn } from "@/lib/banking";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
// Not edge: the parser uses JSZip, whose streaming .async() needs setImmediate.

const MAX_STATEMENT_BYTES = 8 * 1024 * 1024;

/**
 * Parse an uploaded bank statement and return the transactions for REVIEW.
 * Deliberately does not save anything — the user sees what was read (and any
 * integrity warnings) before committing it to the ledger via /api/banking.
 */
export async function POST(req: Request) {
  const actor = await getHrActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Please choose a statement file." }, { status: 400 });
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    return NextResponse.json({ error: "That file is larger than 8 MB." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // .xlsx is a ZIP — check the magic bytes rather than trusting the extension.
  if (!(bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return NextResponse.json(
      { error: "That doesn't look like an .xlsx file. Download the Excel version of the statement from net banking (not the PDF)." },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = await parseIdfcStatement(bytes);
  } catch {
    return NextResponse.json({ error: "Couldn't read that spreadsheet — it may be corrupted or password protected." }, { status: 422 });
  }
  if (!parsed.transactions.length) {
    return NextResponse.json(
      { error: "No transactions found. Check this is the IDFC FIRST Bank statement export and covers a period with activity." },
      { status: 422 },
    );
  }

  // Categorise against the live roster so salary/fee rows are auto-matched.
  let roster: RosterEntry[] = [];
  try {
    const employees = (await hrFetch<{ employees?: Employee[] }>("/hr/employees")).employees ?? [];
    roster = employees
      .filter((e) => e.seq > 0)
      .map((e) => ({ seq: e.seq, name: e.name, employmentType: e.employmentType, bankAccount: e.bankAccount }));
  } catch {
    /* categorisation still works, just without employee matching */
  }
  let transactions = parsed.transactions.map((t) => ({ ...t, ...categorise(t, roster) }));

  // Learn from past corrections: if the user has already classified a
  // counterparty by hand (e.g. "AMITA JAIN" -> Loan), apply that to new rows
  // from the same counterparty instead of making them reclassify it every
  // month. The classification history IS the rule set — no separate config to
  // maintain or drift out of sync.
  try {
    const known = (await hrFetch<{ transactions: BankTxn[] }>("/hr/banking")).transactions ?? [];
    const learned = new Map<string, string>();
    for (const t of known) {
      if (t.categorySetBy !== "user" || !t.counterparty) continue;
      learned.set(t.counterparty.toUpperCase(), t.category);
    }
    if (learned.size) {
      transactions = transactions.map((t) => {
        const rule = t.counterparty ? learned.get(t.counterparty.toUpperCase()) : undefined;
        // Never override a confident employee match — payroll beats a name rule.
        return rule && !t.matchedEmployeeSeq ? { ...t, category: rule, categorySetBy: "user" } : t;
      });
    }
  } catch {
    /* learning is a convenience; a failure here must not block the import */
  }

  return NextResponse.json({ ok: true, ...parsed, transactions, fileName: file.name });
}
