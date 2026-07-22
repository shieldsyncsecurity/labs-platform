import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log — ShieldSync HR", robots: { index: false, follow: false } };

type AuditEvent = { auditId?: string; actor?: string; action?: string; target?: string; detail?: Record<string, unknown>; createdAt?: string };

const ACTION_LABEL: Record<string, string> = {
  "employee.create": "Created employee",
  "employee.update": "Updated employee",
  "employee.delete": "Deleted employee",
  "employee.offboard": "Marked exited",
  "employee.reactivate": "Reactivated",
  "kyc.upload": "Uploaded KYC document",
  "kyc.download": "Downloaded KYC document",
  "kyc.delete": "Deleted KYC document",
  "doc.generate": "Issued document",
  "doc.email": "Emailed document",
  "audit.export": "Exported audit log",
};

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDetail(detail?: Record<string, unknown>): string {
  if (!detail) return "";
  return Object.entries(detail)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function AuditPage() {
  let audit: AuditEvent[] = [];
  let error: string | null = null;
  try {
    audit = (await hrFetch<{ audit: AuditEvent[] }>("/hr/audit", { query: { limit: 200 } })).audit ?? [];
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Dashboard</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Audit log</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676" }}>Every action in the portal — who did what, when. Most recent first (last 200).</p>
        </div>
        <a
          href="/api/audit/export"
          style={{ fontSize: 12.5, fontWeight: 700, color: "#1f3a5f", border: "1px solid #c3cee0", borderRadius: 8, padding: "7px 12px", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          Export CSV
        </a>
      </div>

      {error ? (
        <div style={{ marginTop: 18, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{error}</div>
      ) : audit.length === 0 ? (
        <p style={{ marginTop: 18, fontSize: 13, color: "#8a94a3" }}>No activity yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 18, fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
              <th style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>When</th>
              <th style={{ padding: "8px 10px" }}>Who</th>
              <th style={{ padding: "8px 10px" }}>Action</th>
              <th style={{ padding: "8px 10px" }}>Target</th>
              <th style={{ padding: "8px 10px" }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a, i) => (
              <tr key={a.auditId ?? i} style={{ borderTop: "1px solid #eef2f7", verticalAlign: "top" }}>
                <td style={{ padding: "8px 10px", color: "#5b6676", whiteSpace: "nowrap" }}>{fmtWhen(a.createdAt)}</td>
                <td style={{ padding: "8px 10px", color: "#1b2331" }}>{a.actor}</td>
                <td style={{ padding: "8px 10px", color: "#1f3a5f", fontWeight: 600 }}>{ACTION_LABEL[a.action ?? ""] ?? a.action}</td>
                <td style={{ padding: "8px 10px", color: "#5b6676", fontFamily: "monospace", fontSize: 11.5 }}>{a.target}</td>
                <td style={{ padding: "8px 10px", color: "#8a94a3" }}>{fmtDetail(a.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
