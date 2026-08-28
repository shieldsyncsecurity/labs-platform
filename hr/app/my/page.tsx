import Link from "next/link";
import { redirect } from "next/navigation";
import { getSelfSession } from "@/lib/server/self-session";
import { hrFetch } from "@/lib/server/hr-engine";
import type { Employee } from "@/lib/employee";

export const dynamic = "force-dynamic";
export const metadata = { title: "My documents — ShieldSync", robots: { index: false, follow: false } };

type Gen = { docId: string; docType: string; title: string; ref: string; generatedAt: string };

const DOCTYPE_LABEL: Record<string, string> = {
  offer: "Appointment letter",
  payslip: "Salary slip",
  verification: "Verification letter",
  experience: "Experience / relieving letter",
  leave: "Leave approval letter",
  increment: "Salary revision letter",
  confirmation: "Confirmation letter",
  "internship-offer": "Letter of Intent — Internship",
  completion: "Certificate of completion",
  "employment-history": "Employment history certificate",
  "resignation-acceptance": "Resignation acceptance letter",
  fnf: "Full & Final settlement",
};

// Everything here is scoped to session.seq, taken from the SIGNED ss_self
// cookie — never from a URL param or form field. That's what makes this safe
// to expose without an HR login: there is no seq for her to tamper with.
export default async function MyDocs() {
  const session = await getSelfSession();
  if (!session) redirect("/my/login");

  let employee: Employee | null = null;
  let docs: Gen[] = [];
  try {
    employee = (await hrFetch<{ employee: Employee }>(`/hr/employees/${session.seq}`)).employee;
    docs = (await hrFetch<{ generated: Gen[] }>(`/hr/employees/${session.seq}/generated`)).generated;
  } catch {
    // Session still valid but the record is gone (deleted) — sign out cleanly.
    redirect("/my/login");
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 18, borderBottom: "2px solid #1f3a5f", marginBottom: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/cipher-s-mark.png" alt="" width={40} height={40} style={{ borderRadius: 9 }} />
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#1f3a5f" }}>ShieldSync Security Private Limited</div>
          <div style={{ fontSize: 11.5, fontStyle: "italic", color: "#2f4fb0" }}>Empowering Cybersecurity Futures</div>
        </div>
      </div>

      {(() => {
        // Role comes from the employee record itself — status and engagement
        // type — never from anything client-supplied.
        const exited = employee?.status === "exited";
        const isIntern = /internship/i.test(employee?.employmentType ?? "");
        const role = exited ? "Former employee" : isIntern ? "Intern" : "Employee";
        const badge = exited
          ? { bg: "#f2f5fa", fg: "#5b6676", bd: "#dfe5ef" }
          : isIntern
            ? { bg: "#eef6ff", fg: "#1f3a5f", bd: "#c3d8f0" }
            : { bg: "#e7f6ee", fg: "#146c3c", bd: "#b7e2c9" };
        return (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: "#1b2331" }}>{employee?.name}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: badge.fg, background: badge.bg, border: `1px solid ${badge.bd}`, borderRadius: 999, padding: "2px 10px", letterSpacing: ".03em", textTransform: "uppercase" }}>
                    {role}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: "#5b6676", marginTop: 2 }}>{employee?.employeeId}</div>
              </div>
              <form action="/api/self/logout" method="post">
                <button type="submit" style={{ background: "none", border: "none", color: "#2f4fb0", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
                  Sign out
                </button>
              </form>
            </div>

            {!exited && employee ? (
              <div style={{ marginTop: 18, border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 }}>
                <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14, marginBottom: 10 }}>Your details</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                  {(
                    [
                      ["Designation", employee.designation],
                      ["Engagement", employee.employmentType],
                      ["Date of joining", employee.dateOfJoining],
                      ["Work location", employee.baseLocation],
                    ] as Array<[string, string | undefined]>
                  )
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#8a94a3", textTransform: "uppercase", letterSpacing: ".06em" }}>{k}</div>
                        <div style={{ fontSize: 13, color: "#1b2331", marginTop: 3 }}>{v}</div>
                      </div>
                    ))}
                </div>
                <div style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 12, lineHeight: 1.5 }}>
                  If any of these details are wrong, write to hr@shieldsyncsecurity.com.
                </div>
              </div>
            ) : null}

            {exited ? (
              <p style={{ fontSize: 12, color: "#8a94a3", marginTop: 14, lineHeight: 1.55 }}>
                Your employment records are archived. Documents issued to you remain available here to view, download or email.
              </p>
            ) : null}
          </>
        );
      })()}

      <div style={{ marginTop: 24, border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 }}>
        <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14, marginBottom: 10 }}>Your documents</div>
        {docs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "#8a94a3" }}>Nothing has been issued to you yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map((d, i) => (
              <Link
                key={d.docId}
                href={`/my/doc/${d.docId}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", border: "1px solid #c3cee0", borderRadius: 8, textDecoration: "none", color: "#1b2331", fontSize: 13, background: "#fbfcfe" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#8a94a3", fontWeight: 700, fontSize: 12.5 }}>{i + 1}.</span>
                  {/* Payslips all share one DOCTYPE_LABEL ("Salary slip") but the
                      month is what actually distinguishes them — d.title already
                      carries it ("Salary Slip - February 2026"), so prefer that
                      here specifically rather than collapsing every month to the
                      same generic label. */}
                  <span style={{ fontWeight: 700 }}>{d.docType === "payslip" ? d.title || "Salary Slip" : (DOCTYPE_LABEL[d.docType] ?? d.title ?? d.docType)}</span>
                </span>
                <span style={{ color: "#1f3a5f", fontWeight: 700, fontSize: 12.5 }}>{d.ref}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
