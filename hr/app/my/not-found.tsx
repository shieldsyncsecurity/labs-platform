import Link from "next/link";

// Self-serve 404 boundary. Without this, a 404 from /my/doc/[genId] (a deleted
// or regenerated document link) falls through to the global not-found, whose
// only link goes to admin-only /employees — a dead end for an ex-employee.
// This keeps them inside the self-serve area with a route back to their docs.
export default function MyNotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 19, fontWeight: 800, color: "#1f3a5f" }}>Document not found</h1>
      <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
        This document link is no longer valid — it may have been updated or removed. Your other documents are still available.
      </p>
      <Link href="/my" style={{ display: "inline-block", marginTop: 14, color: "#2f4fb0", fontSize: 13, fontWeight: 600 }}>
        &larr; Your documents
      </Link>
    </main>
  );
}
