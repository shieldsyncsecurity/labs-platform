import Link from "next/link";
import { getPayrollDue } from "@/lib/server/payroll-due";
import { getViewer } from "@/lib/server/hr-access";
import { restrictedSeqs } from "@/lib/server/employee-view";

/**
 * Standing reminder that someone hasn't been paid yet. Renders on the dashboard
 * (and anywhere else worth nagging) whenever an active employee has no payslip
 * issued for the month that just closed — so the prompt is there every time HR
 * opens the portal, without anyone remembering a date.
 *
 * Renders NOTHING when payroll is clear: an always-present strip becomes
 * wallpaper, and the whole point is that its presence means "act".
 */
export async function PayrollDueBanner() {
  let s: Awaited<ReturnType<typeof getPayrollDue>>;
  try {
    // This banner NAMES who hasn't been paid — administrator-only records must
    // not be named here for staff viewers.
    const { seqs, hideAll } = await restrictedSeqs(await getViewer());
    if (hideAll) return null;
    s = await getPayrollDue(new Date(), seqs);
  } catch {
    // Engine unreachable. This banner is the ONLY payroll signal on the admin
    // dashboard (getViewer doesn't hit the engine for an admin, so the page's
    // error boundary never fires here) — returning null would make an outage
    // look identical to "everyone is paid", defeating the reminder. Show an
    // explicit "couldn't check" strip instead, so absence-of-banner keeps its
    // one honest meaning: all clear.
    return (
      <section
        aria-label="Payroll status unavailable"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, background: "#f3f5f9", border: "1px solid #d4dbe8", borderRadius: 10, padding: "12px 14px", marginBottom: 20 }}
      >
        <span style={{ background: "#8a94a3", color: "#fff", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, borderRadius: 5, padding: "3px 7px", textTransform: "uppercase" }}>
          Unknown
        </span>
        <p style={{ flex: 1, minWidth: 260, margin: 0, fontSize: 13, color: "#41506a" }}>
          Couldn&rsquo;t check payroll status right now — the data service didn&rsquo;t respond. This is <b>not</b> a confirmation that everyone is paid.
        </p>
        <Link href="/payslips" style={{ background: "#1f3a5f", color: "#fff", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>
          Open payroll →
        </Link>
      </section>
    );
  }
  if (s.due.length === 0) return null;

  // Amber while it's simply due; red once it's past the first week.
  const tone = s.overdue
    ? { bg: "#fff5f5", border: "#f0b4b4", ink: "#8c2f2f", chip: "#b3383f" }
    : { bg: "#fff9ec", border: "#eed9a4", ink: "#7a5714", chip: "#a06a10" };

  const names = s.due.slice(0, 3).map((d) => d.name).join(", ");
  const more = s.due.length - Math.min(3, s.due.length);

  return (
    <section
      aria-label="Payroll reminder"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 20,
      }}
    >
      <span
        style={{
          background: tone.chip,
          color: "#fff",
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: 0.6,
          borderRadius: 5,
          padding: "3px 7px",
          textTransform: "uppercase",
        }}
      >
        {s.overdue ? "Overdue" : "Due"}
      </span>
      <div style={{ flex: 1, minWidth: 260 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: tone.ink }}>
          Salary for {s.monthLabel} is {s.overdue ? "overdue" : "due"} — {s.due.length} of {s.total}{" "}
          {s.due.length === 1 ? "person has" : "people have"} no payslip yet
        </p>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#5b6676" }}>
          {names}
          {more > 0 ? ` +${more} more` : ""}
        </p>
      </div>
      <Link
        href={`/payslips?month=${s.month}`}
        style={{
          background: "#1f3a5f",
          color: "#fff",
          borderRadius: 7,
          padding: "8px 14px",
          fontSize: 12.5,
          fontWeight: 700,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Run payroll →
      </Link>
    </section>
  );
}
