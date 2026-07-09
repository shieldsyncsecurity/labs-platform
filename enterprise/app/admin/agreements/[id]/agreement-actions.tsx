"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { renderTemplate, type AgreementDocType, type AgreementParams } from "@/lib/legal/templates";
import { NegotiatedBanner } from "../../_components/agreement-bits";

// Status-gated actions for one agreement (W3-4):
// - draft:   Edit text (inline textarea -> /api/admin/agreements/update),
//            Issue (2-step), Void (2-step), Download PDF
// - issued:  Void (2-step), Download PDF
// - other:   Download PDF only (accepted/superseded/void are permanent records)
// Every mutation goes through an app/api/admin/* route that re-checks the
// admin session and forwards the staff actor; after success we
// router.refresh() so the server page re-reads engine state (same pattern as
// orders-section.tsx).

const primaryBtn =
  "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60";
const secondaryBtn =
  "rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60";
const dangerBtn =
  "rounded-lg border border-rose-200 bg-surface px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60";
const cancelBtn =
  "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas disabled:opacity-60";

const normalize = (s: string) => s.replace(/\r\n?/g, "\n");

export default function AgreementActions({
  agreementId,
  status,
  docType,
  params,
  bodyText,
}: {
  agreementId: string;
  status: string;
  docType: string;
  params: Record<string, string>;
  bodyText: string;
}) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bodyText);
  const [confirming, setConfirming] = useState<"issue" | "void" | null>(null);
  const [busy, setBusy] = useState<"save" | "issue" | "void" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Live customized indicator while editing: compare against a fresh render
  // of the stored params. The server re-derives this on save regardless.
  let renderedBaseline: string | null = null;
  if (docType === "msa" || docType === "dpa") {
    try {
      renderedBaseline = normalize(
        renderTemplate(docType as AgreementDocType, params as unknown as AgreementParams),
      );
    } catch {
      renderedBaseline = null;
    }
  }
  const editCustomized = renderedBaseline !== null && normalize(text) !== renderedBaseline;

  async function post(path: string, kind: "save" | "issue" | "void", okMessage: string) {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "save" ? { agreementId, bodyText: text } : { agreementId },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "The action failed. Try again.");
        setBusy(null);
        setConfirming(null);
        return;
      }
      setMessage(okMessage);
      setEditing(false);
      setConfirming(null);
      setBusy(null);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(null);
      setConfirming(null);
    }
  }

  const isDraft = status === "draft";
  const isIssued = status === "issued";

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink-soft">Actions</h2>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {isDraft && !editing ? (
          <button
            type="button"
            onClick={() => {
              setText(bodyText);
              setEditing(true);
              setError(null);
              setMessage(null);
            }}
            className={secondaryBtn}
          >
            Edit text
          </button>
        ) : null}

        {isDraft && confirming !== "issue" ? (
          <button
            type="button"
            onClick={() => setConfirming("issue")}
            disabled={editing || busy !== null}
            className={primaryBtn}
          >
            Issue
          </button>
        ) : null}
        {confirming === "issue" ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">
              Issuing locks the text permanently and lets the org accept it. Continue?
            </span>
            <button
              type="button"
              onClick={() =>
                post("/api/admin/agreements/issue", "issue", "Agreement issued. The org can now accept it from the portal.")
              }
              disabled={busy !== null}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "issue" ? "Issuing..." : "Yes, issue"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy !== null}
              className={cancelBtn}
            >
              Cancel
            </button>
          </span>
        ) : null}

        {(isDraft || isIssued) && confirming !== "void" ? (
          <button
            type="button"
            onClick={() => setConfirming("void")}
            disabled={editing || busy !== null}
            className={dangerBtn}
          >
            Void
          </button>
        ) : null}
        {confirming === "void" ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-xs text-rose-700">
              Voiding retires this agreement permanently (the record is kept). Continue?
            </span>
            <button
              type="button"
              onClick={() => post("/api/admin/agreements/void", "void", "Agreement voided.")}
              disabled={busy !== null}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "void" ? "Voiding..." : "Yes, void"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy !== null}
              className={cancelBtn}
            >
              Cancel
            </button>
          </span>
        ) : null}

        <a
          href={`/api/admin/agreements/pdf?id=${encodeURIComponent(agreementId)}`}
          className={secondaryBtn}
        >
          Download PDF
        </a>
      </div>

      {editing ? (
        <div className="mt-4 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-soft">Edit draft text</h3>
            <span className="text-xs text-muted">
              {editCustomized
                ? "Edited from the template render"
                : "Matches the template render"}
            </span>
          </div>
          {editCustomized ? (
            <div className="mt-2">
              <NegotiatedBanner />
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={20}
            spellCheck={false}
            aria-label="Agreement full text (editable, draft only)"
            className="mt-3 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs leading-5 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!text.trim()) {
                  setError("Agreement text cannot be empty.");
                  return;
                }
                post("/api/admin/agreements/update", "save", "Draft text saved.");
              }}
              disabled={busy !== null}
              className={primaryBtn}
            >
              {busy === "save" ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setText(bodyText);
                setError(null);
              }}
              disabled={busy !== null}
              className={cancelBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
