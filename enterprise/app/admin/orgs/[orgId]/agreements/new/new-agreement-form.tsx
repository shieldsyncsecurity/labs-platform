"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DOC_TYPE_LABELS,
  renderTemplate,
  type AgreementDocType,
  type AgreementParams,
} from "@/lib/legal/templates";
import { NegotiatedBanner, docTypeLabel } from "../../../../_components/agreement-bits";

// W3-4 new-agreement flow: params form -> Preview (client-safe renderTemplate,
// validation errors inline) -> editable full-text textarea seeded with the
// render. Any hand edit (text !== rendered) marks the draft customized and
// shows the amber negotiated-terms banner. Save posts to
// /api/admin/agreements, which re-derives `customized` server-side and
// proxies the engine's POST /ent/agreements.

export type ExistingAgreementOption = {
  agreementId: string;
  docType: string;
  status: string;
  createdAt?: string;
};

const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const normalize = (s: string) => s.replace(/\r\n?/g, "\n");

function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function NewAgreementForm({
  orgId,
  orgName,
  existingAgreements,
}: {
  orgId: string;
  orgName: string;
  existingAgreements: ExistingAgreementOption[];
}) {
  const router = useRouter();

  const [docType, setDocType] = useState<AgreementDocType>("msa");
  const [companyLegalName, setCompanyLegalName] = useState(orgName);
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [gstin, setGstin] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryTitle, setSignatoryTitle] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [governingLaw, setGoverningLaw] = useState("India");
  const [supersedes, setSupersedes] = useState("");

  // Preview state: `rendered` is the pure template baseline; `text` is what
  // the admin may have edited. customized = they differ.
  const [rendered, setRendered] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [paramsStale, setParamsStale] = useState(false);
  const [replaceConfirm, setReplaceConfirm] = useState(false);

  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const customized = rendered !== null && normalize(text) !== normalize(rendered);

  const params: AgreementParams = {
    companyLegalName: companyLegalName.trim(),
    registeredAddress: registeredAddress.trim(),
    gstin: gstin.trim() || undefined,
    signatoryName: signatoryName.trim(),
    signatoryTitle: signatoryTitle.trim(),
    effectiveDate: effectiveDate.trim(),
    governingLaw: governingLaw.trim(),
  };

  // Any param/docType change after a preview means the textarea no longer
  // matches the inputs -- flag it so the admin re-previews before saving.
  function touch<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      if (rendered !== null) setParamsStale(true);
    };
  }

  function validateParams(): string | null {
    if (!params.companyLegalName) return "Company legal name is required.";
    if (!params.registeredAddress) return "Registered address is required.";
    if (!params.signatoryName) return "Signatory name is required.";
    if (!params.signatoryTitle) return "Signatory title is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.effectiveDate)) {
      return "Effective date is required (YYYY-MM-DD).";
    }
    if (!params.governingLaw) return "Governing law is required.";
    return null;
  }

  function handlePreview(force: boolean) {
    setPreviewError(null);
    setSaveError(null);
    const invalid = validateParams();
    if (invalid) {
      setPreviewError(invalid);
      return;
    }
    // Re-rendering would clobber hand-edited text -- make that a 2-step.
    if (!force && customized) {
      setReplaceConfirm(true);
      return;
    }
    setReplaceConfirm(false);
    try {
      const output = renderTemplate(docType, params);
      setRendered(output);
      setText(output);
      setParamsStale(false);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Could not render the template.");
    }
  }

  async function handleSave() {
    setSaveError(null);
    const invalid = validateParams();
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    if (rendered === null || !text.trim()) {
      setSaveError("Preview the agreement first, then save the draft.");
      return;
    }
    if (paramsStale) {
      setSaveError("Parameters changed since the last preview. Preview again before saving.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          docType,
          params,
          bodyText: text,
          customized,
          supersedes: supersedes || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data?.error ?? "Could not save the draft.");
        setSaving(false);
        return;
      }
      if (data?.agreementId) {
        router.push(`/admin/agreements/${data.agreementId}`);
      } else {
        router.push(`/admin/orgs/${orgId}`);
      }
      router.refresh();
    } catch {
      setSaveError("Could not reach the server. Try again.");
      setSaving(false);
    }
  }

  const supersedesOptions = existingAgreements.filter((a) => a.docType === docType);

  return (
    <div className="space-y-6">
      {/* Document type + params */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink-soft">Document</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(DOC_TYPE_LABELS) as AgreementDocType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => touch(setDocType)(t)}
              aria-pressed={docType === t}
              className={
                docType === t
                  ? "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                  : "rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
              }
            >
              {DOC_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <h3 className="mt-5 border-t border-line pt-5 text-sm font-semibold text-ink-soft">
          Parameters
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="agCompany" className="mb-1 block text-xs font-medium text-ink-soft">
              Company legal name
            </label>
            <input
              id="agCompany"
              type="text"
              maxLength={200}
              value={companyLegalName}
              onChange={(e) => touch(setCompanyLegalName)(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="agGstin" className="mb-1 block text-xs font-medium text-ink-soft">
              GSTIN <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="agGstin"
              type="text"
              maxLength={20}
              value={gstin}
              onChange={(e) => touch(setGstin)(e.target.value)}
              placeholder="e.g. 29ABCDE1234F1Z5"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="agAddress" className="mb-1 block text-xs font-medium text-ink-soft">
              Registered address
            </label>
            <input
              id="agAddress"
              type="text"
              maxLength={500}
              value={registeredAddress}
              onChange={(e) => touch(setRegisteredAddress)(e.target.value)}
              placeholder="Full registered office address"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="agSignatory" className="mb-1 block text-xs font-medium text-ink-soft">
              Signatory name
            </label>
            <input
              id="agSignatory"
              type="text"
              maxLength={120}
              value={signatoryName}
              onChange={(e) => touch(setSignatoryName)(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="agSignatoryTitle"
              className="mb-1 block text-xs font-medium text-ink-soft"
            >
              Signatory title
            </label>
            <input
              id="agSignatoryTitle"
              type="text"
              maxLength={120}
              value={signatoryTitle}
              onChange={(e) => touch(setSignatoryTitle)(e.target.value)}
              placeholder="e.g. Director"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="agEffective" className="mb-1 block text-xs font-medium text-ink-soft">
              Effective date
            </label>
            <input
              id="agEffective"
              type="date"
              value={effectiveDate}
              onChange={(e) => touch(setEffectiveDate)(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="agLaw" className="mb-1 block text-xs font-medium text-ink-soft">
              Governing law
            </label>
            <input
              id="agLaw"
              type="text"
              maxLength={80}
              value={governingLaw}
              onChange={(e) => touch(setGoverningLaw)(e.target.value)}
              className={inputClass}
            />
          </div>
          {supersedesOptions.length > 0 ? (
            <div>
              <label htmlFor="agSupersedes" className="mb-1 block text-xs font-medium text-ink-soft">
                Supersedes <span className="font-normal text-muted">(optional)</span>
              </label>
              <select
                id="agSupersedes"
                value={supersedes}
                onChange={(e) => setSupersedes(e.target.value)}
                className={inputClass}
              >
                <option value="">None</option>
                {supersedesOptions.map((a) => (
                  <option key={a.agreementId} value={a.agreementId}>
                    {docTypeLabel(a.docType)} ({a.status}) {a.agreementId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={() => handlePreview(false)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            {rendered === null ? "Preview" : "Re-render preview"}
          </button>
          {replaceConfirm ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-xs text-amber-800">
                Re-rendering replaces your edited text. Continue?
              </span>
              <button
                type="button"
                onClick={() => handlePreview(true)}
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                Replace edited text
              </button>
              <button
                type="button"
                onClick={() => setReplaceConfirm(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-canvas"
              >
                Keep my edits
              </button>
            </span>
          ) : null}
          {paramsStale ? (
            <span className="text-xs text-amber-800">
              Parameters changed since the last preview &mdash; re-render before saving.
            </span>
          ) : null}
        </div>
        {previewError ? <p className="mt-2 text-xs text-rose-700">{previewError}</p> : null}
      </div>

      {/* Rendered text -> editable draft */}
      {rendered !== null ? (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-soft">Agreement text</h2>
            <span className="text-xs text-muted">
              {customized ? "Edited from the template render" : "Matches the template render"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            This exact text is what gets stored, issued, and accepted. Edit it only for negotiated
            terms.
          </p>
          {customized ? (
            <div className="mt-3">
              <NegotiatedBanner />
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={24}
            spellCheck={false}
            aria-label="Agreement full text (editable)"
            className="mt-3 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs leading-5 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save draft"}
            </button>
            <span className="text-xs text-muted">
              Saved as a draft &mdash; nothing is visible to the org until you issue it.
            </span>
          </div>
          {saveError ? <p className="mt-2 text-xs text-rose-700">{saveError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
