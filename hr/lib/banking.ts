// Bank statement model + IDFC FIRST Bank .xlsx parser.
//
// Why parse the XLSX and not the PDF: the same download offers both, and the
// spreadsheet has exact typed columns — no OCR, no column-drift guessing. The
// PDF is a rendering of this same data.
//
// The statement carries its own totals footer ("Total number of Debits/Credits"
// and total debit/credit amounts). We parse those too and check them against
// what we extracted, so a silently-dropped row is caught at import time rather
// than showing up as a wrong balance weeks later.

import JSZip from "jszip";

/**
 * Built-in categories, plus anything the user types. The `(string & {})` arm
 * keeps editor autocomplete for the known values while still permitting a
 * custom label — a small business always has a bucket nobody predicted, and
 * forcing those into "Uncategorised" makes the money view useless.
 */
export type BankCategory =
  | "salary"
  | "professional-fee"
  | "revenue"
  | "vendor"
  | "tax"
  | "bank-charge"
  | "owner-funds"
  | "loan"
  | "transfer"
  | "other"
  | (string & {});

const BUILT_IN_LABELS: Record<string, string> = {
  salary: "Salary",
  "professional-fee": "Professional fee",
  revenue: "Client revenue",
  vendor: "Vendor / expense",
  tax: "Tax (GST / TDS)",
  "bank-charge": "Bank charges",
  "owner-funds": "Owner funds",
  loan: "Loan (given / repaid)",
  transfer: "Internal transfer",
  other: "Uncategorised",
};

/** Display name — a custom category shows exactly as the user typed it. */
export function categoryLabel(c: BankCategory): string {
  return BUILT_IN_LABELS[c] ?? c;
}

/** Kept as an alias so existing lookups keep working. */
export const CATEGORY_LABEL = BUILT_IN_LABELS;

/** Dropdown order for the built-ins; custom values are appended at runtime. */
export const CATEGORY_ORDER: BankCategory[] = [
  "revenue",
  "owner-funds",
  "loan",
  "salary",
  "professional-fee",
  "vendor",
  "tax",
  "bank-charge",
  "transfer",
  "other",
];

export type BankTxn = {
  /** Deterministic — re-importing the same statement updates rather than duplicates. */
  txnId: string;
  accountNumber: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM (grouping key)
  valueDate?: string;
  particulars: string;
  chequeNo?: string;
  method?: string; // UPI / NEFT / IMPS / RTGS / IFT / Charge
  counterparty?: string; // best-effort name pulled out of `particulars`
  debit: number; // 0 when this row is a credit
  credit: number; // 0 when this row is a debit
  balance: number;
  category: BankCategory;
  /**
   * "user" once a human has classified this row. The engine uses it to protect
   * the choice from being reverted by a later re-import, and the parser uses it
   * to learn counterparty rules (classify "AMITA JAIN" as a loan once, and
   * future imports follow).
   */
  categorySetBy?: "user";
  /** Set when the counterparty resolves to someone on the employee roster. */
  matchedEmployeeSeq?: number;
  note?: string;
  importedAt?: string;
  importedBy?: string;
};

export type ParsedStatement = {
  accountNumber: string;
  customerName?: string;
  periodLabel?: string;
  transactions: BankTxn[];
  /** The bank's own footer figures, for the integrity check below. */
  stated: {
    debitCount?: number;
    creditCount?: number;
    totalDebit?: number;
    totalCredit?: number;
    openingBalance?: number;
    closingBalance?: number;
  };
  /** Populated when our extraction disagrees with the bank's stated totals. */
  warnings: string[];
};

// ---------------------------------------------------------------- xlsx reading

type Cell = { col: string; value: string };

/** Minimal XLSX reader: shared strings + one sheet, preserving COLUMN LETTERS.
 * Empty cells are omitted entirely in the file format, so anything positional
 * (nth value in a row) silently shifts debit into credit. Always key by column. */
async function readSheet(bytes: Uint8Array): Promise<Map<number, Cell[]>> {
  const zip = await JSZip.loadAsync(bytes);
  const ssXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""),
  );

  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) throw new Error("NO_SHEET");
  const xml = await sheetFile.async("string");

  const rows = new Map<number, Cell[]>();
  for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(rm[1]);
    const cells: Cell[] = [];
    for (const cm of rm[2].matchAll(
      /<c r="([A-Z]+)\d+"(?:[^>]*?t="(\w+)")?[^>]*?>(?:<v>([^<]*)<\/v>|<is>([\s\S]*?)<\/is>)?<\/c>/g,
    )) {
      const col = cm[1];
      const type = cm[2];
      const raw = cm[3];
      const inline = cm[4];
      let value = "";
      if (inline !== undefined) {
        value = [...inline.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("");
      } else if (raw !== undefined) {
        value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
      }
      if (value !== "") cells.push({ col, value });
    }
    if (cells.length) rows.set(rowNum, cells);
  }
  return rows;
}

const cellAt = (cells: Cell[], col: string): string => cells.find((c) => c.col === col)?.value ?? "";

// ------------------------------------------------------------------- parsing

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "21-Jul-2025" -> "2025-07-21". Returns "" when it isn't a date. */
export function parseStatementDate(s: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((s ?? "").trim());
  if (!m) return "";
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return "";
  return `${m[3]}-${mm}-${String(Number(m[1])).padStart(2, "0")}`;
}

const num = (s: string): number => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/** IFSC-ish token, e.g. IDFB0021416 / HDFCH00575020398 — not a person's name. */
const looksLikeRef = (p: string): boolean => /^[A-Z]{4,5}\d/.test(p) || /^\d+$/.test(p);

/**
 * IDFC packs everything into `Particulars` as slash-separated parts, e.g.
 *   UPI/CR/469244718093/DEEPA J/CNRB/9599254/Payment
 *   NEFT/IDFB606970641726/PREETI JAIN/CNRB0019489/Salary
 *   IFT/10254647001/Ms. Diya Jain /11798053/Salary Jan
 *   Charge: AMB_Charges/Inv0902261462375601/28-FEB-2026/
 * Pull out the payment method and the human counterparty name.
 */
export function parseParticulars(particulars: string): { method?: string; counterparty?: string } {
  const raw = (particulars ?? "").trim();
  if (!raw) return {};
  if (/^(CGST|SGST|IGST)\s+on\s+Charge/i.test(raw)) return { method: "Charge" };
  if (/^Charge:/i.test(raw)) return { method: "Charge" };

  const parts = raw.split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return {};
  const method = /^[A-Za-z-]+$/.test(parts[0]) ? parts[0].toUpperCase() : undefined;

  for (const p of parts.slice(1)) {
    if (p.length < 3) continue; // "CR" / "DR" direction markers
    if (looksLikeRef(p)) continue;
    if (!/[A-Za-z]{3}/.test(p)) continue;
    const name = p.replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/i, "").trim();
    if (name.length >= 3) return { method, counterparty: name };
  }
  return { method };
}

/** Stable id so importing the same statement twice updates instead of duplicating. */
function txnIdFor(account: string, date: string, particulars: string, debit: number, credit: number, balance: number): string {
  const basis = [account, date, particulars, debit, credit, balance].join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < basis.length; i++) {
    const c = basis.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `t_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Parse an IDFC FIRST Bank statement .xlsx into normalised transactions. */
export async function parseIdfcStatement(bytes: Uint8Array): Promise<ParsedStatement> {
  const rows = await readSheet(bytes);
  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  let accountNumber = "";
  let customerName: string | undefined;
  let periodLabel: string | undefined;
  const stated: ParsedStatement["stated"] = {};

  // Header + footer labels. NOTE the label column differs between blocks: the
  // header pairs sit in A|B, but the closing totals are labelled in B with the
  // figures out in C/E/F (aligned under the transaction table). Checking only
  // column A silently found nothing and made the integrity check below a no-op.
  for (const [rowNum, cells] of sorted) {
    const a = cellAt(cells, "A").trim();
    const b = cellAt(cells, "B").trim();

    if (/^ACCOUNT NUMBER$/i.test(a)) accountNumber = b;
    else if (/^CUSTOMER NAME$/i.test(a)) customerName = b;
    else if (/^STATEMENT PERIOD$/i.test(a)) periodLabel = b;
    else if (/^Total number of Debits$/i.test(b)) stated.debitCount = num(cellAt(cells, "C"));
    else if (/^Total number of Credits$/i.test(b)) stated.creditCount = num(cellAt(cells, "C"));
    else if (/^Total$/i.test(b)) {
      stated.totalDebit = num(cellAt(cells, "E"));
      stated.totalCredit = num(cellAt(cells, "F"));
    } else if (/^Opening Balance$/i.test(a)) {
      // Header row; the figures land a few (blank) rows below it.
      const valueRow = sorted.find(([n, c]) => n > rowNum && /^-?[\d.]+$/.test(cellAt(c, "A").trim()));
      if (valueRow) {
        stated.openingBalance = num(cellAt(valueRow[1], "A"));
        stated.closingBalance = num(cellAt(valueRow[1], "D"));
      }
    }
  }

  // Find the transaction table header, then read until the dates stop.
  const headerRow = sorted.find(([, cells]) => /^Transaction Date$/i.test(cellAt(cells, "A").trim()));
  const transactions: BankTxn[] = [];
  if (headerRow) {
    for (const [rowNum, cells] of sorted) {
      if (rowNum <= headerRow[0]) continue;
      const date = parseStatementDate(cellAt(cells, "A"));
      if (!date) continue; // footer/blank rows
      const particulars = cellAt(cells, "C").trim();
      const debit = num(cellAt(cells, "E"));
      const credit = num(cellAt(cells, "F"));
      const balance = num(cellAt(cells, "G"));
      if (!particulars && !debit && !credit) continue;
      const { method, counterparty } = parseParticulars(particulars);
      transactions.push({
        txnId: txnIdFor(accountNumber, date, particulars, debit, credit, balance),
        accountNumber,
        date,
        month: date.slice(0, 7),
        valueDate: parseStatementDate(cellAt(cells, "B")) || undefined,
        particulars,
        chequeNo: cellAt(cells, "D").trim() || undefined,
        method,
        counterparty,
        debit,
        credit,
        balance,
        category: "other", // refined by categorise() once the roster is known
      });
    }
  }

  // Integrity check against the bank's own footer.
  const warnings: string[] = [];
  const gotDebits = transactions.filter((t) => t.debit > 0).length;
  const gotCredits = transactions.filter((t) => t.credit > 0).length;
  const sumDebit = transactions.reduce((s, t) => s + t.debit, 0);
  const sumCredit = transactions.reduce((s, t) => s + t.credit, 0);
  const near = (a: number, b: number) => Math.abs(a - b) < 1;

  if (!headerRow) warnings.push("Couldn't find the transaction table — is this an IDFC FIRST Bank statement export?");

  // A MISSING checksum is itself a warning. Silently skipping the comparison
  // (because the footer wasn't found) would report "no problems" while having
  // verified nothing — which is exactly how a dropped row slips through.
  if (stated.debitCount === undefined && stated.creditCount === undefined) {
    warnings.push("Couldn't read the statement's own totals, so the import could not be cross-checked. Verify the transaction count yourself.");
  }
  if (stated.debitCount !== undefined && stated.debitCount !== gotDebits)
    warnings.push(`Statement says ${stated.debitCount} debits, but ${gotDebits} were read.`);
  if (stated.creditCount !== undefined && stated.creditCount !== gotCredits)
    warnings.push(`Statement says ${stated.creditCount} credits, but ${gotCredits} were read.`);
  if (stated.totalDebit !== undefined && !near(stated.totalDebit, sumDebit))
    warnings.push(`Debit total mismatch: statement ${formatINR(stated.totalDebit)}, read ${formatINR(sumDebit)}.`);
  if (stated.totalCredit !== undefined && !near(stated.totalCredit, sumCredit))
    warnings.push(`Credit total mismatch: statement ${formatINR(stated.totalCredit)}, read ${formatINR(sumCredit)}.`);

  // Balance walk: opening + credits - debits should land on the closing figure.
  if (stated.openingBalance !== undefined && stated.closingBalance !== undefined) {
    const expected = stated.openingBalance + sumCredit - sumDebit;
    if (!near(expected, stated.closingBalance))
      warnings.push(
        `Balance doesn't reconcile: ${formatINR(stated.openingBalance)} + ${formatINR(sumCredit)} in − ${formatINR(sumDebit)} out = ${formatINR(expected)}, but the statement closes at ${formatINR(stated.closingBalance)}.`,
      );
  }

  return { accountNumber, customerName, periodLabel, transactions, stated, warnings };
}

// ------------------------------------------------------------ categorisation

export type RosterEntry = { seq: number; name: string; employmentType?: string; bankAccount?: string };

const normaliseName = (s: string): string => (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");

/**
 * Best-effort auto-categorisation. Deliberately conservative: anything it isn't
 * confident about stays "other" for the user to set, rather than being
 * confidently wrong in a money view.
 */
export function categorise(txn: BankTxn, roster: RosterEntry[]): { category: BankCategory; matchedEmployeeSeq?: number } {
  const p = txn.particulars ?? "";

  // Bank's own charges, and the GST levied on them.
  if (/^(CGST|SGST|IGST)\s+on\s+Charge/i.test(p)) return { category: "tax" };
  if (/^Charge:/i.test(p) || /_Charges?\b/i.test(p)) return { category: "bank-charge" };
  if (/\b(TDS|GST|INCOME\s*TAX|ADVANCE\s*TAX)\b/i.test(p)) return { category: "tax" };

  // Someone on the roster? Account number is the strongest signal; fall back to name.
  const cp = normaliseName(txn.counterparty ?? "");
  const match = roster.find((r) => {
    if (r.bankAccount && p.includes(r.bankAccount)) return true;
    const rn = normaliseName(r.name);
    return rn.length >= 5 && cp.length >= 5 && (rn === cp || cp.includes(rn) || rn.includes(cp));
  });

  if (match && txn.debit > 0) {
    const consultant = /consultant|contractor/i.test(match.employmentType ?? "");
    return { category: consultant ? "professional-fee" : "salary", matchedEmployeeSeq: match.seq };
  }

  // Money in from a company reads as client revenue; from an individual it's
  // more likely owner/related-party funding — but both are left for review.
  if (txn.credit > 0) {
    if (/\b(PRIVATE LIMITED|LIMITED|LLP|PVT|TECHNOLOGIES|SOLUTIONS|SERVICES)\b/i.test(p)) return { category: "revenue" };
    return { category: "owner-funds" };
  }

  return { category: "other" };
}

/** Month key -> in/out/net plus a per-category breakdown. */
export function summarise(txns: BankTxn[]): {
  totalIn: number;
  totalOut: number;
  net: number;
  byCategory: Array<{ category: BankCategory; in: number; out: number; count: number }>;
} {
  const totalIn = txns.reduce((s, t) => s + t.credit, 0);
  const totalOut = txns.reduce((s, t) => s + t.debit, 0);
  const map = new Map<BankCategory, { in: number; out: number; count: number }>();
  for (const t of txns) {
    const cur = map.get(t.category) ?? { in: 0, out: 0, count: 0 };
    cur.in += t.credit;
    cur.out += t.debit;
    cur.count += 1;
    map.set(t.category, cur);
  }
  // Built-ins first in their canonical order, then any custom categories the
  // user invented. Filtering to CATEGORY_ORDER alone would drop custom rows
  // from the breakdown and the totals would silently stop adding up.
  const seen = new Set<string>();
  const ordered: BankCategory[] = [];
  for (const c of CATEGORY_ORDER) if (map.has(c)) { ordered.push(c); seen.add(c); }
  for (const c of [...map.keys()].sort()) if (!seen.has(c)) ordered.push(c);
  const byCategory = ordered.map((c) => ({ category: c, ...map.get(c)! }));
  return { totalIn, totalOut, net: totalIn - totalOut, byCategory };
}

export const formatINR = (n: number): string =>
  "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
