"use client";

import { useState } from "react";

const btn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };

/** Admin control: (re)issue this employee's self-serve login PIN. Shows the
 * plaintext PIN exactly once — it is never stored or retrievable again. */
export function SelfPinControl({ seq, employeeId, hasPin }: { seq: string; employeeId: string; hasPin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    if ((hasPin || pin) && !confirm("This replaces the current PIN — the old one stops working immediately. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${seq}/self-pin`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not set the PIN.");
      } else {
        setPin(data.pin);
      }
    } catch {
      setError("Could not reach the server — check the connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button type="button" onClick={issue} disabled={busy} style={btn}>
        {busy ? "Working…" : hasPin || pin ? "Reissue self-serve PIN" : "Set up self-serve login"}
      </button>
      {pin ? (
        <span style={{ fontSize: 12.5 }}>
          ID <b>{employeeId}</b> · PIN <b style={{ letterSpacing: 2 }}>{pin}</b>
          <span style={{ color: "#8a94a3" }}> — shown once, copy it now</span>
        </span>
      ) : hasPin ? (
        <span style={{ fontSize: 12.5, color: "#5b6676" }}>Self-serve login is set up.</span>
      ) : (
        <span style={{ fontSize: 12.5, color: "#8a94a3" }}>Not set up yet.</span>
      )}
      {error ? <span style={{ fontSize: 12.5, color: "#a33" }}>{error}</span> : null}
    </div>
  );
}
