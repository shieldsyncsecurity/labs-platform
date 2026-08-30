// The employee record is the most-opened page and is force-dynamic behind
// engine round-trips; a route-level skeleton at the record's own 820px width
// (vs the shared 1180 skeleton) avoids a blank screen AND a width jump on load.
export default function Loading() {
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "36px 24px", fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#5b6676", fontSize: 13 }}>
        <span style={{ width: 16, height: 16, border: "2.5px solid #d9dfea", borderTopColor: "#1f3a5f", borderRadius: "50%", display: "inline-block", animation: "ssspin .8s linear infinite" }} />
        Loading…
      </div>
      <style>{`@keyframes ssspin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ height: 22, width: "40%", background: "#eef2f8", borderRadius: 6, marginTop: 22 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 20 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 }}>
            <div style={{ height: 10, width: "30%", background: "#eef2f8", borderRadius: 5 }} />
            {[80, 100, 70, 90].map((w, j) => (
              <div key={j} style={{ height: 12, width: `${w}%`, background: "#f1f4f9", borderRadius: 5, marginTop: 12 }} />
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
