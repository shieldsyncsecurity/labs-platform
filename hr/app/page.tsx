import Link from "next/link";
import { can } from "@/lib/access";
import { getViewer } from "@/lib/server/hr-access";
import { PayrollDueBanner } from "@/components/PayrollDueBanner";

export const dynamic = "force-dynamic";

// Dashboard — a task launcher, grouped by where each task sits in the actual
// HR lifecycle (recruit -> employ -> pay -> govern), the same shape big HR
// suites (Workday, SAP SuccessFactors) use for their home screens: modules
// ordered by the funnel a person moves through, not alphabetically. Audit is
// deliberately the smallest, least visually loud item — it's occasional
// oversight, not a task done often, and enterprise portals tuck compliance
// links into a lighter slot rather than giving it hero-card weight.
//
// maxWidth MATCHES TopNav's container (1180) on purpose — a narrower value
// here left the whole page inset far right of the logo on wide screens, an
// alignment bug independent of the grouping work.
export default async function Home() {
  // The launcher only offers what this person can actually do. An empty section
  // is removed entirely rather than left as a heading with nothing under it.
  const { actor, isAdmin, access } = await getViewer();
  const allow = (area: Parameters<typeof can>[1], need: "read" | "write" = "read") => isAdmin || can(access, area, need);
  const showRecruiting = allow("candidates") || allow("employees", "write");
  const showRecords = allow("employees") || allow("kyc");
  const showPayroll = allow("payroll") || allow("banking");
  const nothing = !showRecruiting && !showRecords && !showPayroll && !allow("audit");

  const card: React.CSSProperties = {
    display: "block",
    border: "1px solid #d9dfea",
    borderRadius: 12,
    padding: "18px 20px",
    background: "#fff",
    textDecoration: "none",
    color: "#1b2331",
  };
  const h: React.CSSProperties = { fontWeight: 700, color: "#1f3a5f", fontSize: 14.5 };
  const p: React.CSSProperties = { fontSize: 12.5, color: "#5b6676", marginTop: 4, lineHeight: 1.5 };
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 };
  const sectionLabel: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    fontWeight: 800,
    color: "#8a94a3",
    textTransform: "uppercase",
    letterSpacing: ".07em",
    marginBottom: 10,
  };
  const dot = (color: string): React.CSSProperties => ({ width: 7, height: 7, borderRadius: "50%", background: color, flex: "none" });

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "36px 24px 48px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>What do you want to do?</h1>

      {/* Standing payroll reminder — renders only when someone is actually unpaid,
          so its presence always means "act". Shown to whoever can run payroll. */}
      {allow("payroll") ? <div style={{ marginTop: 18 }}><PayrollDueBanner /></div> : null}

      {nothing ? (
        <div style={{ ...card, marginTop: 22, borderStyle: "dashed" }}>
          <div style={h}>Nothing has been shared with you yet</div>
          <div style={p}>
            Your account{actor ? <> (<b style={{ color: "#1b2331" }}>{actor}</b>)</> : null} is set up and signed in, but no
            sections have been turned on for it. Ask the administrator to grant what you need — it applies straight away.
          </div>
        </div>
      ) : null}

      {/* 1. RECRUITING — the funnel entry point; nothing downstream exists until this happens */}
      {showRecruiting ? (
        <section style={{ marginTop: 26 }}>
          <div style={sectionLabel}><span style={dot("#2f4fb0")} />Recruiting</div>
          <div style={grid}>
            {allow("candidates") ? (
              <Link href="/manage-candidates" style={card}>
                <div style={h}>Add or manage candidates</div>
                <div style={p}>Add someone you&rsquo;ve interviewed and send the questionnaire, or follow up with anyone already in your pipeline — then hire in one click.</div>
              </Link>
            ) : null}
            {allow("employees", "write") ? (
              <Link href="/employees/new" style={card}>
                <div style={h}>Add a new employee</div>
                <div style={p}>Create the employee record directly, then issue their appointment or internship offer letter.</div>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 2. EMPLOYEE RECORDS — ongoing management once someone is actually on staff */}
      {showRecords ? (
        <section style={{ marginTop: 28 }}>
          <div style={sectionLabel}><span style={dot("#1f8a5f")} />Employee records</div>
          <div style={grid}>
            {allow("employees") ? (
              <Link href="/employees" style={card}>
                <div style={h}>Issue a letter</div>
                <div style={p}>Open an employee for verification, leave/NOC, confirmation, revision, or relieving letters.</div>
              </Link>
            ) : null}
            {allow("kyc") ? (
              <Link href="/employees" style={card}>
                <div style={h}>Manage KYC documents</div>
                <div style={p}>Upload or retrieve Aadhaar, PAN, bank proof — encrypted, every access logged.</div>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 3. PAYROLL — the recurring monthly/annual money cycle */}
      {showPayroll ? (
        <section style={{ marginTop: 28 }}>
          <div style={sectionLabel}><span style={dot("#b0782f")} />Payroll</div>
          <div style={grid}>
            {allow("payroll") ? (
              <Link href="/payslips" style={card}>
                <div style={h}>Run this month&rsquo;s payroll</div>
                <div style={p}>Generate each active employee&rsquo;s salary slip — ✓ shows who&rsquo;s already done.</div>
              </Link>
            ) : null}
            {allow("banking") ? (
              <Link href="/banking" style={card}>
                <div style={h}>Track money in &amp; out</div>
                <div style={p}>Import the bank statement — see where money came from and went, and whether payroll actually left the account.</div>
              </Link>
            ) : null}
            {allow("payroll") ? (
              <Link href="/payslips/summary" style={card}>
                <div style={h}>Prepare FY / tax numbers</div>
                <div style={p}>April–March salary + TDS summary per employee, from issued slips (Form 16 input).</div>
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4. GOVERNANCE — occasional oversight, not a routine task; deliberately smaller and quieter than the sections above */}
      {allow("audit") ? (
        <section style={{ marginTop: 28 }}>
          <div style={sectionLabel}><span style={dot("#8a94a3")} />Governance</div>
          <Link
            href="/audit"
            style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "13px 18px" }}
          >
            <div>
              <div style={{ ...h, fontSize: 13.5 }}>Review the audit trail</div>
              <div style={p}>Who did what, when — exportable as CSV for compliance evidence.</div>
            </div>
            <span style={{ color: "#8a94a3", fontSize: 18, flex: "none" }}>&rarr;</span>
          </Link>
        </section>
      ) : null}

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 32, borderTop: "1px solid #eef2f7", paddingTop: 16 }}>
        Sample templates: <Link href="/preview/offer" style={{ color: "#2f4fb0" }}>appointment letter</Link> ·{" "}
        <Link href="/preview/internship" style={{ color: "#2f4fb0" }}>internship offer</Link> ·{" "}
        <Link href="/preview/payslip" style={{ color: "#2f4fb0" }}>payslip</Link>
      </div>
    </main>
  );
}
