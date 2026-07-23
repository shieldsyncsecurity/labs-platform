// One date style everywhere. The signed originals themselves drift (offer:
// "27 Feb 2026", leave letter + payslips: "16 July 2026" / "08 April 2026") —
// we standardise on the LONG month, zero-padded day, matching the most recent
// signed documents. Every letter page imports THIS instead of a local today().

export function todayDisplay(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")} ${d.toLocaleString("en-GB", { month: "long" })} ${d.getFullYear()}`;
}

/** "2026-03-02" -> "02 March 2026". */
export function isoToDisplay(iso: string): string {
  const [y, m, dd] = (iso || "").split("-").map(Number);
  if (!y || !m || !dd) return "";
  return `${String(dd).padStart(2, "0")} ${new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" })} ${y}`;
}
