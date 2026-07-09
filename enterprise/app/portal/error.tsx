"use client";

import { useEffect } from "react";

// Route-level error boundary for every /portal page. House style matches the
// assessment not-found page: calm heading, one-line explanation, brand CTA.
// Never render error.message -- it can carry internals (engine URLs, ids).
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[portal] render error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="mt-3 text-ink-soft">
        The portal hit an unexpected error. Your data is safe. Try again, or head back to the
        dashboard.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
        >
          Try again
        </button>
        <a
          href="/portal"
          className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand/40 hover:text-ink"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
