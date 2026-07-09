// Shared presentational bits for the agreements admin UI (W3-4). Pure
// render helpers -- no hooks, no state -- so both server pages (org detail,
// agreement detail) and client components can import them.

export type AgreementStatus = "draft" | "issued" | "accepted" | "superseded" | "void";

/** Human label for an engine docType. 'msa' is sold as "Enterprise Agreement". */
export function docTypeLabel(docType?: string): string {
  if (docType === "msa") return "Enterprise Agreement";
  if (docType === "dpa") return "Data Processing Agreement";
  return docType ?? "Agreement";
}

export function AgreementStatusPill({ status }: { status?: string }) {
  if (status === "draft") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-inset ring-line">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
        Draft
      </span>
    );
  }
  if (status === "issued") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Issued
      </span>
    );
  }
  if (status === "accepted") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Accepted
      </span>
    );
  }
  if (status === "superseded") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-inset ring-line">
        Superseded
      </span>
    );
  }
  if (status === "void") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200">
        Void
      </span>
    );
  }
  return <span className="text-xs text-muted">{status ?? "\u2014"}</span>;
}

/** Small amber marker for agreements whose text was hand-edited (negotiated). */
export function CustomizedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
      Customized
    </span>
  );
}

/**
 * The negotiated-terms warning (owner-specified copy). Shown whenever the
 * stored/edited text differs from the pure template render -- edited legal
 * conditions are ShieldSync's own responsibility to review before issuing.
 */
export function NegotiatedBanner() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span className="font-semibold">Negotiated terms</span> &mdash; edited conditions are
      ShieldSync&apos;s legal responsibility to review.
    </div>
  );
}
