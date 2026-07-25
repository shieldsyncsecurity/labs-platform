import Link from "next/link";
import { hrFetch } from "@/lib/server/hr-engine";
import { isRetentionDue, OUTCOME_OPTIONS, type Candidate } from "@/lib/candidate";
import { CandidateRowActions } from "@/components/CandidateRowActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Candidates — ShieldSync HR", robots: { index: false, follow: false } };

const OUTCOME_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "#eef2f8", fg: "#41506a" },
  shortlisted: { bg: "#e7f0fd", fg: "#22468f" },
  hired: { bg: "#e7f6ee", fg: "#1a7a45" },
  rejected: { bg: "#fdecef", fg: "#9a2233" },
  withdrawn: { bg: "#f6f0e6", fg: "#8a6320" },
};

function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function CandidatesPage() {
  let candidates: Candidate[] = [];
  let error: string | null = null;
  try {
    candidates = (await hrFetch<{ candidates: Candidate[] }>("/hr/candidates")).candidates ?? [];
  } catch {
    error =
      process.env.NODE_ENV !== "production"
        ? "Could not reach the HR engine. Start it with: node engine/hr-server.mjs"
        : "The HR data service is unreachable right now — try again in a moment.";
  }

  const open = candidates.filter((c) => c.outcome === "pending" || c.outcome === "shortlisted");
  const closed = candidates.filter((c) => !open.includes(c));
  const duePurge = candidates.filter(isRetentionDue);

  const rows = (list: Candidate[]) =>
    list
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((c) => {
        const st = OUTCOME_STYLE[c.outcome] ?? OUTCOME_STYLE.pending;
        return (
          <tr key={c.seq} style={{ borderTop: "1px solid #eef2f7" }}>
            <td style={{ padding: "10px" }}>
              <Link href={`/manage-candidates/${c.seq}`} style={{ color: "#1f3a5f", fontWeight: 700, textDecoration: "none" }}>{c.name}</Link>
              <div style={{ fontSize: 11.5, color: "#8a94a3", fontFamily: "monospace" }}>{c.candidateId}</div>
            </td>
            <td style={{ padding: "10px", color: "#5b6676" }}>{c.roleAppliedFor}</td>
            <td style={{ padding: "10px", color: "#5b6676", whiteSpace: "nowrap" }}>{c.interviewedOn || "—"}</td>
            <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
              {c.submittedAt ? (
                <span style={{ color: "#1a7a45", fontWeight: 700, fontSize: 12 }}>✓ Submitted {fmtWhen(c.submittedAt)}</span>
              ) : c.questionnaireSentAt ? (
                <span style={{ color: "#8a6320", fontSize: 12, fontWeight: 600 }}>Sent {fmtWhen(c.questionnaireSentAt)} — awaiting</span>
              ) : (
                <span style={{ color: "#8a94a3", fontSize: 12 }}>Not sent</span>
              )}
            </td>
            <td style={{ padding: "10px", textAlign: "right" }}>
              <span style={{ background: st.bg, color: st.fg, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>
                {OUTCOME_OPTIONS.find((o) => o.value === c.outcome)?.label ?? c.outcome}
              </span>
            </td>
            <td style={{ padding: "10px", textAlign: "right" }}>
              <CandidateRowActions candidate={c} />
            </td>
          </tr>
        );
      });

  const table = (list: Candidate[]) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#8a94a3", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
          <th style={{ padding: "8px 10px" }}>Candidate</th>
          <th style={{ padding: "8px 10px" }}>Role</th>
          <th style={{ padding: "8px 10px" }}>Interviewed</th>
          <th style={{ padding: "8px 10px" }}>Questionnaire</th>
          <th style={{ padding: "8px 10px", textAlign: "right" }}>Outcome</th>
          <th style={{ padding: "8px 10px" }}></th>
        </tr>
      </thead>
      <tbody>{rows(list)}</tbody>
    </table>
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Candidates</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676" }}>
            Interview records. Separate from employees — kept only for this recruitment, not indefinitely.
          </p>
        </div>
        <Link
          href="/manage-candidates/new"
          style={{ background: "#1f3a5f", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "10px 16px", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          + Add candidate
        </Link>
      </div>

      {error ? (
        <div style={{ marginTop: 18, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>{error}</div>
      ) : candidates.length === 0 ? (
        <div style={{ marginTop: 22, border: "1px dashed #ccd5e4", borderRadius: 12, padding: "30px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "#41506a", fontWeight: 600 }}>No candidates yet.</p>
          <p style={{ fontSize: 12.5, color: "#8a94a3", marginTop: 5 }}>
            Add someone you&rsquo;ve interviewed, then email them the questionnaire link to capture their details.
          </p>
          <Link href="/manage-candidates/new" style={{ display: "inline-block", marginTop: 14, color: "#2f4fb0", fontSize: 13, fontWeight: 700 }}>
            Add your first candidate &rarr;
          </Link>
        </div>
      ) : (
        <>
          {duePurge.length > 0 ? (
            <div style={{ marginTop: 16, background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#8a6320", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", lineHeight: 1.55 }}>
              <b>{duePurge.length} candidate record{duePurge.length === 1 ? "" : "s"} past the 12-month retention window.</b> They were not hired,
              so their data no longer serves the purpose it was collected for — open each and delete it.
            </div>
          ) : null}

          {open.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800 }}>In progress</div>
              {table(open)}
            </div>
          ) : null}
          {closed.length > 0 ? (
            <div style={{ marginTop: 26 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "#8a94a3", fontWeight: 800 }}>Closed</div>
              {table(closed)}
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
