"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDisplayDate } from "./DateField";

const input: React.CSSProperties = { padding: "7px 9px", fontSize: 12.5, border: "1px solid #d4dbe8", borderRadius: 6 };
const btn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

// Offboarding: mark an active employee exited (with a last working day) or
// reactivate an exited one. Both are audited by the engine.
export function OffboardControl({ seq, status, lastWorkingDay }: { seq: string; status: string; lastWorkingDay?: string }) {
  const router = useRouter();
  const [iso, setIso] = useState("");
  const [busy, setBusy] = useState(false);

  async function apply(newStatus: "active" | "exited", lwd?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${seq}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus, lastWorkingDay: lwd }),
      });
      if (!res.ok) {
        alert((await res.json().catch(() => ({}))).error ?? "Could not update status.");
      } else {
        router.refresh();
      }
    } catch {
      alert("Could not reach the server — check the connection and try again.");
    }
    setBusy(false);
  }

  if (status === "exited") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ background: "#fdecef", color: "#9a2233", fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: "3px 10px" }}>Exited</span>
        <span style={{ fontSize: 12.5, color: "#5b6676" }}>{lastWorkingDay ? `Last working day: ${lastWorkingDay}` : "Last working day not set"}</span>
        <button type="button" disabled={busy} onClick={() => confirm("Reactivate this employee (back to active)?") && apply("active")} style={{ ...btn, background: "#fff", color: "#1f3a5f", border: "1px solid #c3cee0" }}>
          Reactivate
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
      <div>
        <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 }}>Last working day</label>
        <input type="date" value={iso} onChange={(e) => setIso(e.target.value)} style={input} />
      </div>
      <button
        type="button"
        disabled={busy || !iso}
        onClick={() => {
          const lwd = formatDisplayDate(iso);
          if (confirm(`Mark this employee EXITED with last working day ${lwd}? This unlocks the experience/relieving letter.`)) apply("exited", lwd);
        }}
        style={{ ...btn, opacity: busy || !iso ? 0.5 : 1 }}
      >
        Mark exited
      </button>
    </div>
  );
}
