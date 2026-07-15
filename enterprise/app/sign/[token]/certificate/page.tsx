import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { formatUtcAndIst } from "@/lib/sign/certificate";

// Acceptance-certificate page (print-friendly). Bearer = the same signing
// token; only a SIGNED document has one. The downloadable PDF twin comes from
// /api/sign/certificate -- both render from the same engine record.
//
// WORDING RULE (legal): "electronically accepted" -- never "digitally signed".
export const metadata: Metadata = {
  title: "Certificate of electronic acceptance",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PublicDoc = {
  status?: string;
  title?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  docHash?: string;
  acceptedAt?: string;
  acceptedName?: string;
  acceptedEmail?: string;
  acceptIp?: string;
  acceptUa?: string;
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-line py-3 last:border-b-0 sm:grid-cols-[200px_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`text-sm text-ink ${mono ? "break-all font-mono text-[13px]" : ""}`}>{value}</dd>
    </div>
  );
}

export default async function CertificatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let doc: PublicDoc;
  try {
    doc = await entFetch<PublicDoc>("/ent/doc", { query: { docToken: token } });
  } catch (err) {
    if (err instanceof EntEngineError && (err.status === 404 || err.status === 410)) {
      redirect(`/sign/${token}`);
    }
    throw err;
  }
  if (doc.status !== "signed") {
    redirect(`/sign/${token}`);
  }

  const t = formatUtcAndIst(doc.acceptedAt);
  const hash = doc.docHash || doc.sha256 || "";
  const sizeKb = typeof doc.sizeBytes === "number" ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : "-";

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo href="/" size={24} />
          <Link href={`/sign/${token}`} className="text-sm text-ink-soft hover:text-brand-strong">
            Back to the document
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-xl border border-line bg-surface p-6 sm:p-10 print:border-0 print:p-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-strong">ShieldSync</p>
          <h1 className="mt-1 text-2xl font-bold text-ink">Certificate of Electronic Acceptance</h1>
          <p className="mt-2 text-sm text-muted">
            This certificate evidences that the document below was electronically accepted through
            ShieldSync&apos;s document-acceptance flow.
          </p>

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">Document</h2>
          <dl className="mt-2">
            <Row label="Title" value={doc.title ?? "-"} />
            <Row label="File" value={`${doc.fileName ?? "-"} (${sizeKb})`} />
            <Row label="SHA-256 hash" value={hash} mono />
          </dl>

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">
            Electronically accepted by
          </h2>
          <dl className="mt-2">
            <Row label="Name (typed)" value={doc.acceptedName ?? "-"} />
            <Row label="Verified email" value={`${doc.acceptedEmail ?? "-"} (verified by one-time passcode)`} />
            <Row label="Accepted at" value={`${t.utc} · ${t.ist}`} />
            <Row label="IP address" value={doc.acceptIp || "-"} />
            <Row label="Browser" value={doc.acceptUa || "-"} />
          </dl>

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">
            Acceptance method
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            The signer opened a private, single-recipient signing link; viewed the exact document
            identified by the SHA-256 hash above; verified control of the email address above by
            entering a one-time passcode sent to it; typed their full name; and confirmed
            acceptance by ticking an explicit &quot;I accept&quot; checkbox. The acceptance record was
            written once at the moment of acceptance and is not modifiable afterwards.
          </p>

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">Legal standing</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            This record evidences <strong>electronic acceptance</strong> (click-accept) of the
            document under the Indian Contract Act, 1872, read with Section 10A of the Information
            Technology Act, 2000. It is <strong>not</strong> an electronic signature issued under
            Section 3 of the Information Technology Act, 2000 (Aadhaar eSign or a Digital Signature
            Certificate), and it does not claim to be one.
          </p>

          <div className="mt-10 flex flex-wrap gap-3 print:hidden">
            <a
              href={`/api/sign/certificate?token=${encodeURIComponent(token)}`}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
            >
              Download certificate (PDF)
            </a>
            <a
              href={`/api/sign/pdf?token=${encodeURIComponent(token)}`}
              className="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-brand"
            >
              Download the document (PDF)
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
