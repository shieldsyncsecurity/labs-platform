// Route-level loading state — every page is force-dynamic behind
// Worker→engine round-trips; without this a nav click shows nothing for
// seconds and users click again.
export default function Loading() {
  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#5b6676", fontSize: 13 }}>
        <span
          style={{
            width: 16,
            height: 16,
            border: "2.5px solid #d9dfea",
            borderTopColor: "#1f3a5f",
            borderRadius: "50%",
            display: "inline-block",
            animation: "ssspin .8s linear infinite",
          }}
        />
        Loading…
      </div>
      <style>{`@keyframes ssspin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ marginTop: 22, display: "grid", gap: 10 }}>
        {[70, 100, 100, 55].map((w, i) => (
          <div key={i} style={{ height: 14, width: `${w}%`, background: "#eef2f8", borderRadius: 6 }} />
        ))}
      </div>
    </main>
  );
}
