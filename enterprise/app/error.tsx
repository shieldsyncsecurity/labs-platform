"use client";

import { useEffect } from "react";

// Root error boundary. Catches uncaught errors thrown in the route tree below
// the root layout and renders a calm, on-brand fallback instead of a raw crash.
// The raw error is NEVER shown to the user (it can carry internal detail); it is
// logged to the Workers console (observability) and the user gets only a digest
// reference they can quote to support.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error?.digest ?? "", error?.message ?? String(error));
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
        Something went wrong
      </p>
      <h1 className="mt-3 text-2xl font-bold text-ink">We hit an unexpected error</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The issue has been logged. You can try again, or head back and retry in a moment.
      </p>
      {error?.digest ? (
        <p className="mt-3 font-mono text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex items-center justify-center rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}
