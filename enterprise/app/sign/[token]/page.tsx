import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { entFetch, EntEngineError } from "@/lib/server/ent-engine";
import { formatUtcAndIst } from "@/lib/sign/certificate";
import SignFlow from "./sign-flow";

// Public doc-signing page: /sign/<docToken>. ONE universal flow for any
// PDF + named signer (SOW / proposal / agreement) -- zero per-company
// customization. The token in the path is the bearer credential; the page is
// never indexed and every mutating call goes through our own /api/sign/*
// routes so ENT_ENGINE_SECRET never reaches the browser.
export const metadata: Metadata = {
  title: "Review & accept document",
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
  signerName?: string;
  signerEmailMasked?: string;
  expiresAt?: string;
  createdAt?: string;
  otpLocked?: boolean;
  acceptedAt?: string;
  acceptedName?: string;
  acceptedEmail?: string;
  acceptIp?: string;
  acceptUa?: string;
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Logo href="/" size={24} />
          <span className="text-xs text-muted">Document acceptance</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      <footer className="mx-auto max-w-3xl px-6 pb-10">
        <p className="text-xs text-muted">
          Questions about this document? Contact{" "}
          <a href="mailto:info@shieldsyncsecurity.com" className="underline hover:text-ink">
            info@shieldsyncsecurity.com
          </a>
          .
        </p>
      </footer>
    </div>
  );
}

function DeadLink({ heading, body }: { heading: string; body: string }) {
  return (
    <Shell>
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-bold text-ink">{heading}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">{body}</p>
      </div>
    </Shell>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let doc: PublicDoc;
  try {
    doc = await entFetch<PublicDoc>("/ent/doc", { query: { docToken: token } });
  } catch (err) {
    if (err instanceof EntEngineError && err.status === 410) {
      return (
        <DeadLink
          heading="This signing link has expired"
          body="The acceptance window for this document has closed. Please ask the person who shared it with you to send a fresh link."
        />
      );
    }
    if (err instanceof EntEngineError && err.status === 404) {
      return (
        <DeadLink
          heading="Link not found"
          body="This signing link doesn't exist or is no longer active. Check that you opened the complete link from your email."
        />
      );
    }
    return (
      <DeadLink
        heading="Temporarily unavailable"
        body="We couldn't load this document right now. Please try again in a minute."
      />
    );
  }

  const signed = doc.status === "signed";
  const accepted = signed ? formatUtcAndIst(doc.acceptedAt) : null;
  const pdfUrl = `/api/sign/pdf?token=${encodeURIComponent(token)}`;
  const sizeKb = typeof doc.sizeBytes === "number" ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : null;

  return (
    <Shell>
      <div className="rounded-xl border border-line bg-surface p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {signed ? "Executed document" : "For your review and acceptance"}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{doc.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {doc.fileName}
          {sizeKb ? ` (${sizeKb})` : ""} · shared by ShieldSync
          {doc.signerName ? ` with ${doc.signerName}` : ""}
        </p>

        {signed ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-900">
              Electronically accepted by {doc.acceptedName}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              {doc.acceptedEmail} (email verified by one-time code) · {accepted?.utc}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                href={`/sign/${token}/certificate`}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                View acceptance certificate
              </Link>
              <a
                href={`/api/sign/certificate?token=${encodeURIComponent(token)}`}
                className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
              >
                Download certificate (PDF)
              </a>
            </div>
          </div>
        ) : null}

        {/* The exact stored PDF -- served through our own route, hash-checked
            by the engine on every read. */}
        <div className="mt-6 overflow-hidden rounded-lg border border-line">
          <object data={pdfUrl} type="application/pdf" className="h-[70vh] w-full">
            <div className="flex h-40 flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
              <p className="text-sm text-muted">
                Your browser can&apos;t display the PDF inline.
              </p>
              <a
                href={pdfUrl}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
              >
                Open the document
              </a>
            </div>
          </object>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <a href={pdfUrl} className="text-sm font-medium text-brand-strong underline hover:no-underline">
            Download the document (PDF)
          </a>
          <p className="break-all text-[11px] text-muted" title="SHA-256 integrity hash of this exact file">
            SHA-256: {doc.sha256}
          </p>
        </div>

        {!signed ? (
          <SignFlow
            token={token}
            signerEmailMasked={doc.signerEmailMasked ?? "your registered email"}
            initialLocked={doc.otpLocked === true}
          />
        ) : null}
      </div>

      {!signed ? (
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Accepting here records your typed name, your one-time-code-verified email address, the
          date and time, your IP address, and the document&apos;s SHA-256 hash as evidence of
          electronic acceptance (Indian Contract Act, 1872 read with Section 10A of the IT Act,
          2000). This is a click-accept flow, not an Aadhaar eSign or Digital Signature
          Certificate.
        </p>
      ) : null}
    </Shell>
  );
}
