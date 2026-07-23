import Link from "next/link";
import { notFound } from "next/navigation";
import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { getQuestionnaire } from "@/lib/questionnaire";
import { QuestionnaireEditor } from "@/components/QuestionnaireEditor";
import type { Candidate } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit questions — ShieldSync HR", robots: { index: false, follow: false } };

export default async function EditQuestions({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  let c: Candidate;
  try {
    c = (await hrFetch<{ candidate: Candidate }>(`/hr/candidates/${seq}`)).candidate;
  } catch (err) {
    if (err instanceof HrEngineError && err.status === 404) notFound();
    throw err;
  }

  // Whatever this candidate would see right now — either their tailored copy
  // (if we already edited them once) or the default from lib/questionnaire.ts.
  const effective = c.customQuestionnaire ?? getQuestionnaire(c.questionnaireRole);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <Link href={`/candidates/${seq}`} style={{ fontSize: 12, color: "#2f4fb0" }}>&larr; {c.name}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1f3a5f" }}>Edit questions for {c.name}</h1>
          <p style={{ fontSize: 12.5, color: "#5b6676" }}>
            {c.customQuestionnaire
              ? "This is a tailored copy for this candidate — edits below only affect what she sees."
              : "You're starting from the standard questionnaire. Any edit here becomes a tailored copy for this candidate only."}
          </p>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <QuestionnaireEditor candidate={c} initial={effective} />
      </div>
    </main>
  );
}
