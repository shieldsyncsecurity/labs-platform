import Link from "next/link";

// Dashboard — a task launcher. Brand + identity + primary nav live in the
// TopNav (layout); this page answers "what do you want to do?".
export default function Home() {
  const card: React.CSSProperties = {
    display: "block",
    border: "1px solid #d9dfea",
    borderRadius: 12,
    padding: "16px 18px",
    background: "#fff",
    textDecoration: "none",
    color: "#1b2331",
  };
  const h: React.CSSProperties = { fontWeight: 700, color: "#1f3a5f" };
  const p: React.CSSProperties = { fontSize: 12, color: "#5b6676", marginTop: 3 };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>What do you want to do?</h1>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Link href="/candidates" style={card}>
          <div style={h}>Interview someone</div>
          <div style={p}>Add a candidate and email them the detailed questionnaire — then hire them in one click.</div>
        </Link>
        <Link href="/employees/new" style={card}>
          <div style={h}>Hire someone</div>
          <div style={p}>Add the employee record, then issue their appointment or internship offer letter.</div>
        </Link>
        <Link href="/payslips" style={card}>
          <div style={h}>Run this month&rsquo;s payroll</div>
          <div style={p}>Generate each active employee&rsquo;s salary slip — ✓ shows who&rsquo;s already done.</div>
        </Link>
        <Link href="/employees" style={card}>
          <div style={h}>Issue a letter</div>
          <div style={p}>Open an employee for verification, leave/NOC, confirmation, revision, or relieving letters.</div>
        </Link>
        <Link href="/employees" style={card}>
          <div style={h}>Manage KYC documents</div>
          <div style={p}>Upload or retrieve Aadhaar, PAN, bank proof — encrypted, every access logged.</div>
        </Link>
        <Link href="/payslips/summary" style={card}>
          <div style={h}>Prepare FY / tax numbers</div>
          <div style={p}>April–March salary + TDS summary per employee, from issued slips (Form 16 input).</div>
        </Link>
        <Link href="/audit" style={card}>
          <div style={h}>Review the audit trail</div>
          <div style={p}>Who did what, when — exportable as CSV for compliance evidence.</div>
        </Link>
      </div>

      <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 16 }}>
        Sample templates: <Link href="/preview/offer" style={{ color: "#2f4fb0" }}>letter</Link> ·{" "}
        <Link href="/preview/payslip" style={{ color: "#2f4fb0" }}>payslip</Link>
      </div>
    </main>
  );
}
