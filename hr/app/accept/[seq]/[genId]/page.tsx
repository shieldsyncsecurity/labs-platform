import { hrFetch, HrEngineError } from "@/lib/server/hr-engine";
import { AcceptButton } from "@/components/AcceptButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept your document", robots: { index: false, follow: false } };

type AcceptStatus = { docType: string; title: string; ref: string; acceptedAt: string | null };

// Unauthenticated URL params interpolated into an engine path — see the POST
// route for why these are shape-checked before use.
const SEQ_RE = /^[0-9]{1,9}$/;
const GENID_RE = /^g_[A-Za-z0-9_]{1,60}$/;

export default async function AcceptPage({ params }: { params: Promise<{ seq: string; genId: string }> }) {
  const { seq, genId } = await params;
  if (!SEQ_RE.test(seq) || !GENID_RE.test(genId)) {
    return (
      <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", fontFamily: "Arial, sans-serif", textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "#5b6676" }}>This link is no longer valid.</p>
      </main>
    );
  }
  let status: AcceptStatus;
  try {
    status = await hrFetch<AcceptStatus>(`/hr/employees/${seq}/generated/${genId}/accept`);
  } catch (err) {
    const notFound = err instanceof HrEngineError && err.status === 404;
    return (
      <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", fontFamily: "Arial, sans-serif", textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "#5b6676" }}>
          {notFound ? "This link is no longer valid." : "Something went wrong — please try again shortly."}
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 24px", fontFamily: "Arial, sans-serif", textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#1f3a5f", marginBottom: 4 }}>ShieldSync Security</div>
      <p style={{ fontSize: 13.5, color: "#1b2331", lineHeight: 1.6, margin: "20px 0" }}>
        {status.title} &mdash; <b>{status.ref}</b>
      </p>
      {status.acceptedAt ? (
        <p style={{ fontSize: 13.5, color: "#1a7a3d", fontWeight: 700 }}>
          Accepted on {new Date(status.acceptedAt).toLocaleString("en-IN")}.
        </p>
      ) : (
        <AcceptButton seq={seq} genId={genId} />
      )}
      <p style={{ fontSize: 11, color: "#5b6676", marginTop: 24, lineHeight: 1.6 }}>
        This confirms you have seen and agree to the document sent to you by email. You will still sign the
        physical original in person at the office on your joining date.
      </p>
    </main>
  );
}
