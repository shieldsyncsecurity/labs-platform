import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getViewer } from "@/lib/server/hr-access";
import { can } from "@/lib/access";
import { getQuestionnaire } from "@/lib/questionnaire";
import { isRetentionDue, retentionDueDate, interviewDateLabel, interviewPanelLabel, OUTCOME_OPTIONS, type Candidate } from "@/lib/candidate";
import { AnswersView } from "@/components/QuestionnaireForm";
import { SendQuestionnaire, OutcomeControl, DeleteCandidateButton } from "@/components/CandidateControls";
import { InterviewScheduler } from "@/components/InterviewScheduler";
import { graphConfigured } from "@/lib/server/graph";

export const dynamic = "force-dynamic";
export const metadata = { title: "Candidate — ShieldSync HR", robots: { index: false, follow: false } };

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 };
const groupTitle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 8 };

const row = (k: string, v?: string | number) => (
  <div style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 12.5 }}>
    <div style={{ width: 140, color: "#8a94a3", flex: "none" }}>{k}</div>
    <div style={{ color: "#1b2331" }}>{v || "—"}</div>
  </div>
);

export default async function CandidateDetail({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let c: Candidate;
  try {
    c = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${seq}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  // Edit, tailor questions, schedule, send, set outcome, hire and delete are all
  // candidate WRITES; a candidates:read viewer sees the record but none of the
  // controls that would 403. Admin always passes.
  const { isAdmin, access } = await getViewer();
  const canWrite = isAdmin || can(access, "candidates", "write");

  const q = getQuestionnaire(c.questionnaireRole);
  const outcomeLabel = OUTCOME_OPTIONS.find((o) => o.value === c.outcome)?.label ?? c.outcome;
  const dueDate = retentionDueDate(c);

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href="/manage-candidates" style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; Candidates</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: "#1f3a5f" }}>{c.name}</h1>
          <div style={{ fontSize: 12.5, color: "#5b6676", marginTop: 2 }}>
            <span style={{ fontFamily: "monospace" }}>{c.candidateId}</span> · {c.roleAppliedFor} · {outcomeLabel}
          </div>
        </div>
        {canWrite ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link href={`/manage-candidates/${seq}/edit`} style={{ color: "#2f4fb0", fontSize: 12.5, fontWeight: 600 }}>Edit</Link>
            <DeleteCandidateButton candidate={c} />
          </div>
        ) : null}
      </div>

      {c.convertedEmployeeId ? (
        <div style={{ marginTop: 14, background: "#e7f6ee", border: "1px solid #b7e2c9", color: "#146c3c", fontSize: 12.5, borderRadius: 8, padding: "10px 12px" }}>
          <b>Hired</b> — now employee{" "}
          <Link href={`/employees/${c.convertedSeq}`} style={{ color: "#146c3c", fontWeight: 700 }}>{c.convertedEmployeeId}</Link>. This hiring record is kept as the
          evidence of how they were recruited.
        </div>
      ) : isRetentionDue(c) ? (
        <div style={{ marginTop: 14, background: "#fdf4e3", border: "1px solid #f0dfb8", color: "#8a6320", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", lineHeight: 1.55 }}>
          <b>Past the retention window (due {dueDate}).</b> This candidate wasn&rsquo;t hired, so their data no longer serves the purpose it was
          collected for — delete it unless you have a reason to keep it.
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 18 }}>
        <div style={card}>
          <div style={groupTitle}>Contact</div>
          {row("Email", c.email)}
          {row("Mobile", c.phone)}
          {row("Source", c.source)}
        </div>
        <div style={card}>
          <div style={groupTitle}>Interview</div>
          {/* Derived from the scheduler's interviews[] first, falling back to the
              legacy free-text fields — so a booked round doesn't read as "—". */}
          {row("Interviewed on", interviewDateLabel(c) ?? undefined)}
          {row("Interviewed by", interviewPanelLabel(c) ?? undefined)}
          {row("Questionnaire", q.roleTitle)}
          {!c.convertedEmployeeId && dueDate ? row("Delete data by", dueDate) : null}
          <div style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 12.5 }}>
            <div style={{ width: 140, color: "#8a94a3", flex: "none" }}>Salary proof</div>
            <div>
              {c.salaryProof ? (
                <a href={`/api/candidates/${seq}/proof`} target="_blank" rel="noreferrer" style={{ color: "#2f4fb0", fontWeight: 600 }}>
                  {c.salaryProof.fileName}
                  <span style={{ color: "#8a94a3", fontWeight: 400 }}> ({Math.round(c.salaryProof.sizeBytes / 1024)} KB)</span>
                </a>
              ) : (
                <span style={{ color: "#8a94a3" }}>Not uploaded</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {c.notes ? (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={groupTitle}>Your interview notes (internal)</div>
          <div style={{ fontSize: 13, color: "#1b2331", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{c.notes}</div>
        </div>
      ) : null}

      {canWrite ? (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>Questions for this candidate</div>
              <p style={{ fontSize: 12, color: "#5b6676", margin: "4px 0 0", lineHeight: 1.55 }}>
                {c.customQuestionnaire
                  ? "This candidate has a tailored questionnaire — you can keep editing it or reset to the standard one."
                  : "You can tailor the questions before sending the link — wording, options, add or remove anything."}
              </p>
            </div>
            <Link
              href={`/manage-candidates/${seq}/questions`}
              style={{ background: c.customQuestionnaire ? "#e7f0fd" : "#fff", color: "#1f3a5f", border: "1px solid #c3cee0", fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: "8px 14px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              {c.customQuestionnaire ? "Edit questions →" : "Tailor questions →"}
            </Link>
          </div>
        </div>
      ) : null}

      {/* Scheduling sits above the questionnaire: you interview first, then
          send the questions. The page should read in the order the work happens.
          All three are candidate writes, so they render only for writers. */}
      {canWrite ? (
        <>
          <InterviewScheduler candidate={c} teamsConnected={graphConfigured()} />
          <SendQuestionnaire candidate={c} />
          <OutcomeControl candidate={c} />
        </>
      ) : null}

      {canWrite && !c.convertedEmployeeId ? (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: "#1f3a5f", fontSize: 14 }}>Hire this candidate</div>
          <p style={{ fontSize: 12, color: "#5b6676", margin: "5px 0 10px", lineHeight: 1.55 }}>
            Creates the employee record (prefilled from their questionnaire) and opens it, where you can issue their offer letter.
          </p>
          <Link
            href={`/manage-candidates/${seq}/hire`}
            style={{ background: "#1f3a5f", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "10px 16px", textDecoration: "none", display: "inline-block" }}
          >
            Hire &rarr; create employee record
          </Link>
        </div>
      ) : null}

      <div style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1f3a5f", marginBottom: 10 }}>
          Questionnaire responses
          {c.submittedAt ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: "#8a94a3" }}>
              {" "}· submitted {new Date(c.submittedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : null}
        </h2>
        {c.submittedAt && c.answers ? (
          <AnswersView q={q} answers={c.answers} />
        ) : (
          <div style={{ border: "1px dashed #ccd5e4", borderRadius: 10, padding: "24px 20px", textAlign: "center", fontSize: 13, color: "#8a94a3" }}>
            {c.questionnaireSentAt ? "Sent — waiting for the candidate to submit." : "Send them the questionnaire link above to collect their details."}
          </div>
        )}
      </div>
    </main>
  );
}
