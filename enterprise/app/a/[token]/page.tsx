import CandidateFlow from "./candidate-flow";

// Candidate-facing entry point: /a/<inviteToken>. Server component only reads
// the route param and hands off to the client state machine — the token
// itself is never a secret credential by design (the engine's /ent/invite
// GET returns a sanitized subset only), but all mutating calls still go
// through our own /api/* routes so the ENT_ENGINE_SECRET never reaches the
// browser.
export default async function CandidateAssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CandidateFlow token={token} />;
}
