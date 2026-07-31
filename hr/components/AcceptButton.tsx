"use client";
import { useState } from "react";

export function AcceptButton({ seq, genId }: { seq: string; genId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  // Typing your own name is what separates "the person this was issued to
  // accepted" from "whoever opened a forwarded link pressed a button".
  const [name, setName] = useState("");
  const ready = name.trim().length >= 2;

  async function accept() {
    if (!ready) return;
    setState("sending");
    try {
      const res = await fetch(`/api/accept/${seq}/${genId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return <p style={{ fontSize: 13.5, color: "#1a7a3d", fontWeight: 700 }}>Thank you &mdash; recorded.</p>;
  }

  return (
    <>
      <label style={{ display: "block", textAlign: "left", fontSize: 12, color: "#5b6676", marginBottom: 6 }}>
        Type your full name to confirm
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={state === "sending"}
          autoComplete="name"
          style={{
            display: "block", width: "100%", marginTop: 5, padding: "10px 12px",
            border: "1px solid #c3cee0", borderRadius: 8, fontSize: 14, color: "#1b2331",
          }}
        />
      </label>
      <button
        onClick={accept}
        disabled={state === "sending" || !ready}
        style={{
          background: ready ? "#1f3a5f" : "#eef2f8", color: ready ? "#fff" : "#8a94a3",
          border: ready ? "none" : "1px solid #d4dbe8", borderRadius: 8,
          padding: "11px 28px", fontSize: 14, fontWeight: 700,
          cursor: state === "sending" || !ready ? "default" : "pointer",
          opacity: state === "sending" ? 0.6 : 1, marginTop: 4, width: "100%",
        }}
      >
        {state === "sending" ? "Recording…" : "I Accept This Offer"}
      </button>
      {state === "error" ? (
        <p style={{ fontSize: 12, color: "#b0281f", marginTop: 10 }}>Could not record this — please try again.</p>
      ) : null}
    </>
  );
}
