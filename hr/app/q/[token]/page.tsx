import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getQuestionnaire } from "@/lib/questionnaire";
import { COMPANY } from "@/lib/company";
import { QuestionnaireForm, AnswersView } from "@/components/QuestionnaireForm";
import { QUESTIONNAIRE_LINK_HOURS, type PublicCandidateView } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Candidate questionnaire — ShieldSync Security", robots: { index: false, follow: false } };

const shell: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "28px 18px 40px",
  fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "#f6f8fc", minHeight: "100vh" }}>
      <div style={{ background: "#1f3a5f", padding: "16px 18px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", gap: 11 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cipher-s-mark.png" alt="" width={30} height={30} style={{ display: "block" }} />
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 14.5, letterSpacing: ".01em" }}>{COMPANY.legalName}</div>
            <div style={{ color: "#a9bcd8", fontSize: 11 }}>{COMPANY.tagline}</div>
          </div>
        </div>
      </div>
      <div style={shell}>{children}</div>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div style={{ background: "#fff", border: "1px solid #e2e8f2", borderRadius: 12, padding: "26px 24px", marginTop: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f" }}>{title}</h1>
        <p style={{ fontSize: 13.5, color: "#5b6676", marginTop: 8, lineHeight: 1.65 }}>{body}</p>
        <p style={{ fontSize: 13, color: "#5b6676", marginTop: 14 }}>
          Need help? Write to <a href={`mailto:${COMPANY.hrEmail}`} style={{ color: "#2f4fb0" }}>{COMPANY.hrEmail}</a>.
        </p>
      </div>
    </Shell>
  );
}

// PUBLIC candidate questionnaire. Token-authenticated: no portal session, no
// navigation into the portal, and the engine only ever returns this one
// candidate's name + role (and their own answers once submitted).
export default async function QuestionnairePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let view: PublicCandidateView;
  try {
    view = (await hrFetch<{ candidate: PublicCandidateView }>(`/hr/questionnaire/${encodeURIComponent(token)}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 410) {
      return <Notice title="This link has expired" body="For your security these links are time-limited. Please reply to the email we sent you and we'll send a fresh one straight away." />;
    }
    if (err instanceof HrEngineError && err.status === 404) {
      return <Notice title="This link is not valid" body="The link may have been mistyped or copied incompletely. Please open it directly from the email we sent you." />;
    }
    return <Notice title="Something went wrong at our end" body="We couldn't load your form just now. Please try again in a few minutes — your link is still valid." />;
  }

  // Prefer the tailored copy the HR user built for this candidate, if any.
  const q = view.customQuestionnaire ?? getQuestionnaire(view.questionnaireRole);

  // Already submitted: show them exactly what they sent (what the owner asked for).
  if (view.submittedAt && view.answers) {
    return (
      <Shell>
        <div style={{ background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 12, padding: "18px 20px", marginBottom: 18 }}>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: "#146c3c" }}>Your responses have been received</div>
          <p style={{ fontSize: 13.5, color: "#2f6a4c", marginTop: 6, lineHeight: 1.6 }}>
            Submitted on{" "}
            {new Date(view.submittedAt).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}. Your
            answers are below for your records. If something needs correcting, email{" "}
            <a href={`mailto:${COMPANY.hrEmail}`} style={{ color: "#146c3c", fontWeight: 700 }}>{COMPANY.hrEmail}</a>.
          </p>
        </div>
        <AnswersView q={q} answers={view.answers} />
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 style={{ fontSize: 21, fontWeight: 800, color: "#1f3a5f", marginTop: 6 }}>Hello {view.name.split(" ")[0]} 👋</h1>
      <p style={{ fontSize: 13.5, color: "#5b6676", marginTop: 4 }}>
        Candidate questionnaire — <b style={{ color: "#1b2331" }}>{view.roleAppliedFor || q.roleTitle}</b>
      </p>
      <div style={{ fontSize: 13.5, color: "#41506a", marginTop: 12, lineHeight: 1.7, background: "#fff", border: "1px solid #e2e8f2", borderRadius: 12, padding: "16px 18px", whiteSpace: "pre-line" }}>
        {q.intro}
      </div>

      {/* One-time link — say it plainly and up front, not after they lose work. */}
      <div style={{ marginTop: 12, background: "#fdf4e3", border: "1px solid #f0dfb8", borderRadius: 10, padding: "13px 16px", fontSize: 13, color: "#7a5714", lineHeight: 1.65 }}>
        <b>Please read before you start.</b> This is a personal, one-time link: you can submit this form
        <b> once</b>, so please review your answers before sending. It stops working <b>{QUESTIONNAIRE_LINK_HOURS} hours</b> after we
        sent it, so please fill it in soon. Your answers are saved on this device as you type, so you can take a
        break and come back.
      </div>
      <div style={{ marginTop: 18 }}>
        <QuestionnaireForm token={token} q={q} candidateName={view.name} roleTitle={view.roleAppliedFor || q.roleTitle} salaryProofName={view.salaryProofName} />
      </div>
      <p style={{ fontSize: 11.5, color: "#8a94a3", textAlign: "center", marginTop: 4, lineHeight: 1.6 }}>
        Your responses are stored securely and used only for this recruitment process.
      </p>
    </Shell>
  );
}
