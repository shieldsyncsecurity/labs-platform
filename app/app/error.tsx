"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
      <p className="max-w-xs text-sm text-muted">
        An unexpected error occurred. Try refreshing the page or returning to the catalog.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted">Ref: {error.digest}</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
        >
          Try again
        </button>
        <Link
          href="/labs"
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-canvas"
        >
          Back to labs
        </Link>
      </div>
    </div>
  );
}
