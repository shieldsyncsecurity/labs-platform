import Link from "next/link";
import { AREA_META, AREAS, type Area } from "@/lib/access";
import { getViewer } from "@/lib/server/hr-access";

export const dynamic = "force-dynamic";

// Where the guards send someone who is signed in but not permitted. A plain,
// non-alarming explanation on purpose: this is a routine "not your area", not a
// security incident, and the person hitting it is a colleague.
export default async function NoAccess({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const { area } = await searchParams;
  const { actor } = await getViewer();
  const known = (AREAS as readonly string[]).includes(area ?? "") ? (area as Area) : null;
  const what = known ? AREA_META[known].label : area === "admin" ? "Administrator settings" : "This section";

  return (
    <main style={{ maxWidth: 620, margin: "0 auto", padding: "64px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ background: "#fff", border: "1px solid #e2e8f2", borderRadius: 12, padding: "26px 28px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#8a94a3", textTransform: "uppercase", letterSpacing: ".07em" }}>
          Not available to you
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 800, color: "#1f3a5f", marginTop: 8 }}>{what} isn&rsquo;t part of your access</h1>
        <p style={{ fontSize: 13.5, color: "#41506a", lineHeight: 1.6, marginTop: 10 }}>
          {known ? AREA_META[known].blurb : "This area is restricted."} Your account
          {actor ? <> (<b style={{ color: "#1b2331" }}>{actor}</b>)</> : null} hasn&rsquo;t been given it.
        </p>
        <p style={{ fontSize: 13, color: "#5b6676", lineHeight: 1.6, marginTop: 10 }}>
          If you need it for something you&rsquo;ve been asked to do, ask the administrator to turn it on — it takes them a few
          seconds and applies immediately.
        </p>
        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            href="/"
            style={{ background: "#1f3a5f", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "9px 16px", textDecoration: "none" }}
          >
            Back to what you can do
          </Link>
          <a
            href="/api/auth/logout"
            style={{ background: "#fff", color: "#41506a", border: "1px solid #d4dbe8", fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "9px 16px", textDecoration: "none" }}
          >
            Sign out
          </a>
        </div>
      </div>
    </main>
  );
}
