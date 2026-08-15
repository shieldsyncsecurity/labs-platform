import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 19, fontWeight: 800, color: "#1f3a5f" }}>Not found</h1>
      <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
        This record or document doesn&rsquo;t exist (it may have been deleted).
      </p>
      <Link href="/employees" style={{ display: "inline-block", marginTop: 14, color: "#2f4fb0", fontSize: 13, fontWeight: 600 }}>
        &larr; Back to employees
      </Link>
    </main>
  );
}
