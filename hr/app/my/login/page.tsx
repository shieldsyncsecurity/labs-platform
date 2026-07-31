"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SelfLoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/self/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeId, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed.");
        setBusy(false);
        return;
      }
      router.push("/my");
      router.refresh();
    } catch {
      setError("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#eef2f8",
        padding: 24,
        fontFamily: "Arial, Helvetica, 'Segoe UI', sans-serif",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "#fff",
          border: "1px solid #d9dfea",
          borderRadius: 14,
          padding: "34px 30px",
          boxShadow: "0 12px 34px rgba(31,58,95,.10)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/cipher-s-mark.png" alt="" width={38} height={38} style={{ borderRadius: 9 }} />
          <div>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "#1f3a5f", lineHeight: 1.2 }}>ShieldSync Security</div>
            <div style={{ fontSize: 10.5, fontStyle: "italic", color: "#2f4fb0" }}>Empowering Cybersecurity Futures</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#5b6676", marginTop: 14, marginBottom: 22 }}>
          View your documents
        </div>

        <label style={{ display: "block", fontSize: 12.5, color: "#5b6676", marginBottom: 4 }}>Employee ID</label>
        <input
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          placeholder="SSS/EMP/0010"
          required
          style={{ width: "100%", padding: "9px 11px", fontSize: 14, border: "1px solid #d4dbe8", borderRadius: 8, marginBottom: 14, boxSizing: "border-box" }}
        />

        <label style={{ display: "block", fontSize: 12.5, color: "#5b6676", marginBottom: 4 }}>PIN</label>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          type="password"
          inputMode="numeric"
          placeholder="••••••"
          required
          style={{ width: "100%", padding: "9px 11px", fontSize: 14, border: "1px solid #d4dbe8", borderRadius: 8, marginBottom: 18, boxSizing: "border-box" }}
        />

        {error ? (
          <div style={{ background: "#fdeceb", border: "1px solid #f3c8c4", color: "#a33", fontSize: 12.5, borderRadius: 8, padding: "8px 11px", marginBottom: 14 }}>
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          style={{ width: "100%", background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
        >
          {busy ? "Checking…" : "Sign in"}
        </button>

        <div style={{ fontSize: 11.5, color: "#8a94a3", marginTop: 16, textAlign: "center" }}>
          Your Employee ID and PIN were given to you by ShieldSync. Lost your PIN? Contact info@shieldsyncsecurity.com.
        </div>
      </form>
    </main>
  );
}
