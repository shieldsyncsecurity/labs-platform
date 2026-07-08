"use client";

import { useEffect } from "react";

// Last-resort boundary: catches errors thrown in the ROOT layout itself, where
// the normal app/error.tsx (which renders inside the layout) can't help. It
// must supply its own <html>/<body>, and Tailwind/globals may not be applied
// here, so styles are inlined to guarantee a presentable page in every case.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error?.digest ?? "", error?.message ?? String(error));
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0a1020",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b", maxWidth: "28rem" }}>
            An unexpected error occurred and has been logged. Please try again in a moment.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#94a3b8", fontFamily: "monospace" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              background: "#d97706",
              color: "#fff",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.625rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
