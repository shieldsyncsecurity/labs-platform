"use client";

// Friendly failure boundary (inside the layout, so the TopNav stays usable).
// Typical cause: the HR engine/Lambda is unreachable or cold.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 19, fontWeight: 800, color: "#1f3a5f" }}>Something went wrong</h1>
      <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8, lineHeight: 1.6 }}>
        The HR data service didn&rsquo;t respond. This is usually temporary — try again in a moment.
        {process.env.NODE_ENV !== "production" ? " (Dev: is the engine running? node engine/hr-server.mjs)" : ""}
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Try again
        </button>
        <a href="/" style={{ alignSelf: "center", color: "#2f4fb0", fontSize: 13, fontWeight: 600 }}>Go to dashboard</a>
      </div>
    </main>
  );
}
