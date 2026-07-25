// Interview time handling. Pure and dependency-free so the scheduling form, the
// chat assistant, and the tests all compute the same instant from the same
// words — a form and a chatbot that disagree about what "3pm tomorrow" means
// will eventually send a candidate to the wrong hour.
//
// The company operates in IST. Everything the user types is IST; everything we
// store is a UTC instant. Converting at the edges (here) rather than in each
// caller is what stops a naive `new Date("2026-07-28T15:00")` from silently
// meaning 3pm-in-whatever-zone-the-server-happens-to-be.

/** India Standard Time: UTC+05:30, no daylight saving — a fixed offset is
 *  correct here in a way it would not be for most zones. */
export const IST_OFFSET_MINUTES = 5 * 60 + 30;

export const DURATION_OPTIONS = [15, 30, 45, 60, 90];
export const DEFAULT_DURATION_MINUTES = 45;

/** Build a UTC instant from an IST wall-clock date + time. */
export function istToInstant(dateISO: string, timeHHMM: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeHHMM.trim());
  if (!m || !t) return null;
  const [, y, mo, d] = m;
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (hh > 23 || mm > 59) return null;
  // Date.UTC treats the components as UTC; subtracting the offset converts the
  // IST wall clock to the real instant.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), hh, mm) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMs).toISOString();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Render an instant as IST: "Tue 28 Jul 2026, 3:00 PM IST".
 *
 * Built by hand rather than with toLocaleString: ICU output differs between
 * Node builds and the Workers runtime (comma placement, "pm" vs "PM"), and this
 * string is read back to the user to confirm before a real invite goes out. It
 * has to say the same thing everywhere it renders.
 */
export function formatIST(instantISO: string): string {
  const d = new Date(instantISO);
  if (Number.isNaN(d.getTime())) return "—";
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  const h24 = ist.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mins = String(ist.getUTCMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  return (
    `${DAYS[ist.getUTCDay()]} ${String(ist.getUTCDate()).padStart(2, "0")} ` +
    `${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${h12}:${mins} ${ampm} IST`
  );
}

/** Split an instant back into IST form values, for pre-filling an edit form. */
export function instantToIstParts(instantISO: string): { date: string; time: string } | null {
  const d = new Date(instantISO);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`,
    time: `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`,
  };
}

/** Today's date in IST as YYYY-MM-DD — the right "today" for a form default,
 *  since the server's own date can be a day off around midnight IST. */
export function todayIST(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** Add days to an IST date string. */
export function addDaysIST(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Problems worth stopping the user for. Deliberately warnings, not hard errors:
 * a 7am Sunday interview is unusual, not invalid, and a tool that refuses it is
 * a tool people work around.
 */
export function scheduleWarnings(instantISO: string, now = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(instantISO);
  if (Number.isNaN(d.getTime())) return ["That date and time couldn't be read."];

  if (d.getTime() < now.getTime()) out.push("That time is in the past.");
  else if (d.getTime() - now.getTime() < 60 * 60_000) out.push("That's less than an hour away — the candidate may not see the invite in time.");

  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  const hour = ist.getUTCHours();
  const day = ist.getUTCDay(); // 0 = Sunday
  if (hour < 9 || hour >= 20) out.push("That's outside normal working hours in India (9 AM – 8 PM IST).");
  if (day === 0) out.push("That's a Sunday.");
  return out;
}
