"use client";

// Action bar for the invoice view: Print (browser print dialog -> the @media
// print rules in the page hide everything but the invoice card) and Download
// PDF (a plain link to the admin-gated PDF route). Marked no-print so the bar
// itself never appears on paper.
export default function PrintActions({ pdfHref }: { pdfHref: string }) {
  return (
    <div className="no-print flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
      >
        Print
      </button>
      <a
        href={pdfHref}
        className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
      >
        Download PDF
      </a>
    </div>
  );
}
