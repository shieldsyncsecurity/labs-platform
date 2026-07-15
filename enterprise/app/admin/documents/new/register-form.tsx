"use client";

import { useState } from "react";
import Link from "next/link";

// Register-a-document form. On success we show the signing link ONE time --
// the list page never exposes it again (display ids only), so the staff user
// must copy it here (or rely on the emailed link / the resend action).

type RegisterResult = {
  ok?: boolean;
  link?: string;
  displayId?: string;
  sha256?: string;
  expiresAt?: string;
  emailed?: boolean;
  error?: string;
};

export default function RegisterForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (file instanceof File && file.size > 4 * 1024 * 1024) {
      setError("PDF is larger than 4 MB. Compress or split it first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/documents", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as RegisterResult;
      if (res.ok && data.ok) {
        setResult(data);
      } else {
        setError(data.error ?? "Could not register the document.");
      }
    } catch {
      setError("Could not register the document. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!result?.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable; the link is selectable text right there.
    }
  }

  if (result) {
    return (
      <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-bold text-emerald-900">Document registered</h2>
        <p className="mt-1 text-sm text-emerald-800">
          {result.emailed
            ? "The signing link was emailed to the signer. It's also below -- this is the ONLY time it's shown."
            : "Copy the signing link below and send it to the signer -- this is the ONLY time it's shown. (No email was sent, or the send didn't deliver -- in SES sandbox only verified recipients receive mail.)"}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs text-emerald-950">
            {result.link}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
        <dl className="mt-4 space-y-1 text-xs text-emerald-900">
          <div>
            <dt className="inline font-semibold">Display id (for the list): </dt>
            <dd className="inline font-mono">{result.displayId}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">SHA-256: </dt>
            <dd className="inline break-all font-mono">{result.sha256}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Link valid until: </dt>
            <dd className="inline">{result.expiresAt ? new Date(result.expiresAt).toLocaleString("en-IN") : "-"}</dd>
          </div>
        </dl>
        <div className="mt-5 flex gap-3">
          <Link
            href="/admin/documents"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Back to documents
          </Link>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setCopied(false);
            }}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:border-brand"
          >
            Register another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5 rounded-xl border border-line bg-surface p-6">
      <div>
        <label htmlFor="doc-file" className="block text-sm font-medium text-ink-soft">
          PDF file (max 4 MB)
        </label>
        <input
          id="doc-file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="mt-1 block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-line"
        />
      </div>
      <div>
        <label htmlFor="doc-title" className="block text-sm font-medium text-ink-soft">
          Title (shown to the signer)
        </label>
        <input
          id="doc-title"
          name="title"
          type="text"
          required
          maxLength={200}
          placeholder="e.g. GRC Consulting Proposal -- Acme Pvt Ltd"
          className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="doc-signer-name" className="block text-sm font-medium text-ink-soft">
            Signer name
          </label>
          <input
            id="doc-signer-name"
            name="signerName"
            type="text"
            maxLength={120}
            placeholder="e.g. Priya Sharma"
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="doc-signer-email" className="block text-sm font-medium text-ink-soft">
            Signer email (the one-time code goes here)
          </label>
          <input
            id="doc-signer-email"
            name="signerEmail"
            type="email"
            required
            maxLength={254}
            placeholder="signer@company.com"
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="doc-expires" className="block text-sm font-medium text-ink-soft">
            Link valid for (days)
          </label>
          <input
            id="doc-expires"
            name="expiresDays"
            type="number"
            min={1}
            max={180}
            defaultValue={30}
            className="mt-1 w-28 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="doc-note" className="block text-sm font-medium text-ink-soft">
            Internal note (never shown to the signer)
          </label>
          <input
            id="doc-note"
            name="note"
            type="text"
            maxLength={500}
            placeholder="e.g. FY27 GRC pilot, follow up in a week"
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </div>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink-soft">
        <input type="checkbox" name="sendLink" defaultChecked className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[#d97706]" />
        <span>
          Email the signing link to the signer now.{" "}
          <span className="text-muted">
            (SES sandbox: delivers only to verified addresses -- otherwise copy the link on the
            next screen and send it yourself.)
          </span>
        </span>
      </label>

      {error ? (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Registering…" : "Register & get signing link"}
      </button>
    </form>
  );
}
