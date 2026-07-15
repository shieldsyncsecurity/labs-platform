// Acceptance-certificate content for the doc-signing portal -- ONE place that
// renders the certificate text, shared by the public download route
// (app/api/sign/certificate) and the staff copy (app/api/admin/documents/
// certificate) so the two can never drift.
//
// WORDING RULE (legal, do not soften): this flow produces click-accept
// evidence -- the certificate must say "electronically accepted" and must
// explicitly say it is NOT an Aadhaar eSign / DSC digital signature under
// IT Act section 3. Never use the words "digitally signed" anywhere here.

import { sanitizeToAscii } from "@/lib/pdf/text-pdf";

/** The sanitized public doc shape the engine returns for a SIGNED document. */
export type SignedDocRecord = {
  status?: string;
  title?: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  docHash?: string;
  signerName?: string;
  acceptedAt?: string;
  acceptedName?: string;
  acceptedEmail?: string;
  acceptIp?: string;
  acceptUa?: string;
  createdAt?: string;
};

/** formatUtcAndIst(): an ISO timestamp as both UTC and IST (UTC+05:30) --
 *  acceptance records are read by Indian counterparties, so show both. */
export function formatUtcAndIst(iso: string | undefined): { utc: string; ist: string } {
  if (!iso) return { utc: "-", ist: "-" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { utc: iso, ist: "-" };
  const utc = d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const istMs = d.getTime() + (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(istMs).toISOString().replace("T", " ").replace(/\.\d+Z$/, " IST");
  return { utc, ist };
}

/**
 * buildCertificateText(): the plain-text certificate body fed to buildTextPdf
 * ("# " lines become bold section heads; the doc hash rides in every page
 * footer via the `hash` input). Throws if the record is not a signed one --
 * callers must gate on status before building.
 */
export function buildCertificateText(doc: SignedDocRecord): { title: string; bodyText: string; hash: string } {
  if (doc.status !== "signed") {
    throw new Error("certificate requested for a non-signed document");
  }
  const t = formatUtcAndIst(doc.acceptedAt);
  const hash = doc.docHash || doc.sha256 || "";
  const sizeKb = typeof doc.sizeBytes === "number" ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : "-";

  const bodyText = [
    "# Document",
    `Title: ${doc.title ?? "-"}`,
    `File: ${doc.fileName ?? "-"} (${sizeKb})`,
    `SHA-256 integrity hash of the exact PDF presented and accepted:`,
    `${hash}`,
    "",
    "# Electronically accepted by",
    `Name (typed by the signer as their signature): ${doc.acceptedName ?? "-"}`,
    `Email (verified by one-time passcode): ${doc.acceptedEmail ?? "-"}`,
    `Accepted at: ${t.utc}`,
    `            (${t.ist})`,
    `IP address: ${doc.acceptIp || "-"}`,
    `Browser (user agent): ${doc.acceptUa || "-"}`,
    "",
    "# Acceptance method",
    "The signer opened a private, single-recipient signing link; viewed the exact",
    "document identified by the SHA-256 hash above; verified control of the email",
    "address above by entering a one-time passcode sent to it; typed their full",
    "name; and confirmed acceptance by ticking an explicit \"I accept\" checkbox.",
    "The acceptance record (name, verified email, timestamp, IP address, user",
    "agent, document hash) was written once at the moment of acceptance and is",
    "not modifiable afterwards.",
    "",
    "# Legal standing",
    "This certificate evidences ELECTRONIC ACCEPTANCE (click-accept) of the",
    "document under the Indian Contract Act, 1872, read with Section 10A of the",
    "Information Technology Act, 2000 (validity of contracts formed through",
    "electronic means). It is NOT an electronic signature issued under Section 3",
    "of the Information Technology Act, 2000 (Aadhaar eSign or a Digital",
    "Signature Certificate), and it does not claim to be one.",
    "",
    "Issued by ShieldSync (shieldsyncsecurity.com).",
    `Certificate generated: ${formatUtcAndIst(new Date().toISOString()).utc}`,
  ].join("\n");

  return {
    title: sanitizeToAscii(`Certificate of Electronic Acceptance -- ${doc.title ?? "Document"}`),
    bodyText: sanitizeToAscii(bodyText),
    hash,
  };
}
