import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "56px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <h1 style={{ fontSize: 19, fontWeight: 800, color: "#1f3a5f" }}>Not found</h1>
      <p style={{ fontSize: 13, color: "#5b6676", marginTop: 8 }}>
        This record or document doesn&rsquo;t exist (it may have been deleted).
      </p>
      {/* Route home, not to admin-only /employees — this global boundary also
          catches 404s from the self-serve /my area, whose users have no
          employees access and would dead-end at a login wall. "/" sends each
          role to its correct home. */}
      <Link href="/" style={{ display: "inline-block", marginTop: 14, color: "#2f4fb0", fontSize: 13, fontWeight: 600 }}>
        &larr; Go to home
      </Link>
    </main>
  );
}
