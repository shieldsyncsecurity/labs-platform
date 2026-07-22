import Link from "next/link";
import { getHrActor } from "@/lib/server/hr-session";

// Authenticated dashboard. The middleware guarantees a valid HR session before
// this renders; getHrActor() gives the signed-in email for the header + audit.
export default async function Home() {
  const actor = await getHrActor();

  const card: React.CSSProperties = {
    display: "block",
    border: "1px solid #d9dfea",
    borderRadius: 12,
    padding: "16px 18px",
    background: "#fff",
    textDecoration: "none",
    color: "#1b2331",
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/brand/cipher-s-mark.png" alt="ShieldSync" width={38} height={38} style={{ borderRadius: 9 }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>ShieldSync HR</div>
            <div style={{ fontSize: 11.5, color: "#5b6676" }}>Internal document portal</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11.5, color: "#5b6676" }}>
          {actor ? <div>Signed in as <b style={{ color: "#1f3a5f" }}>{actor}</b></div> : null}
          <a href="/api/auth/logout" style={{ color: "#2f4fb0" }}>
            Sign out
          </a>
        </div>
      </div>

      <div style={{ marginTop: 26, display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 700 }}>
          Manage
        </div>
        <Link href="/employees" style={card}>
          <div style={{ fontWeight: 700, color: "#1f3a5f" }}>Employees &amp; documents</div>
          <div style={{ fontSize: 12, color: "#5b6676", marginTop: 3 }}>Add employees, generate letters, manage KYC (encrypted), and offboard.</div>
        </Link>
        <Link href="/payslips" style={card}>
          <div style={{ fontWeight: 700, color: "#1f3a5f" }}>Payslips</div>
          <div style={{ fontSize: 12, color: "#5b6676", marginTop: 3 }}>Generate monthly salary slips — pick a month, then generate each employee.</div>
        </Link>
        <Link href="/audit" style={card}>
          <div style={{ fontWeight: 700, color: "#1f3a5f" }}>Audit log</div>
          <div style={{ fontSize: 12, color: "#5b6676", marginTop: 3 }}>Every action in the portal — who did what, when.</div>
        </Link>
        <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 4 }}>
          Sample templates: <Link href="/preview/offer" style={{ color: "#2f4fb0" }}>letter</Link> · <Link href="/preview/payslip" style={{ color: "#2f4fb0" }}>payslip</Link>
        </div>
      </div>
    </main>
  );
}
