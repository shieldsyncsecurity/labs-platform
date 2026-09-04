"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * In-app GST configuration — so the owner switches GST on and enters the GSTIN
 * the day it arrives, no code change or deploy. Nothing charges GST while the
 * toggle is off. Admin-only (the route enforces it too).
 */
export function GstSettingsControl({ registered, gstin, defaultRate }: { registered: boolean; gstin: string | null; defaultRate: number }) {
  const router = useRouter();
  const [on, setOn] = useState(registered);
  const [gstinVal, setGstinVal] = useState(gstin ?? "");
  const [rate, setRate] = useState(defaultRate);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Re-sync local state when the server props change underneath us — this
  // component isn't remounted by router.refresh() (same key, same position),
  // so without this a second admin's concurrent save (or this component's
  // own post-save refresh landing new server data) would leave the toggle/
  // GSTIN/rate showing stale values until a hard reload.
  useEffect(() => {
    setOn(registered);
    setGstinVal(gstin ?? "");
    setRate(defaultRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, gstin, defaultRate]);

  const dirty = on !== registered || gstinVal.trim().toUpperCase() !== (gstin ?? "") || rate !== defaultRate;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gstRegistered: on, gstin: gstinVal, gstRate: rate }),
      });
      const data = await res.json();
      if (!res.ok) setMsg({ kind: "err", text: data.error ?? "Could not save." });
      else {
        setMsg({ kind: "ok", text: on ? "GST is now ON — invoices can charge GST and the filing calendar is shown." : "Saved." });
        router.refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Could not reach the server — try again." });
    }
    setBusy(false);
  }

  const label: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };
  const input: React.CSSProperties = { padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff" };

  return (
    <div style={{ border: "1px dashed #c3cee0", borderRadius: 10, padding: "14px 16px", background: "#f8fafc", marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1f3a5f" }}>
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setMsg(null); }} />
          GST registered
        </label>
        <span style={{ fontSize: 11.5, color: "#8a94a3" }}>Turn this on once your GSTIN is received.</span>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginTop: 12 }}>
        <div>
          <label style={label}>GSTIN</label>
          <input value={gstinVal} onChange={(e) => { setGstinVal(e.target.value.toUpperCase()); setMsg(null); }} placeholder="09AAAAA0000A1Z5" maxLength={15} style={{ ...input, width: 200, fontFamily: "monospace", letterSpacing: 1 }} />
        </div>
        <div>
          <label style={label}>Default GST rate</label>
          <select value={rate} onChange={(e) => { setRate(Number(e.target.value)); setMsg(null); }} style={input}>
            {[5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}
          </select>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 7, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: busy || !dirty ? "default" : "pointer", opacity: busy || !dirty ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : "Save GST settings"}
        </button>
      </div>

      {msg ? (
        <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "8px 11px", color: msg.kind === "ok" ? "#146c3c" : "#9a2233", background: msg.kind === "ok" ? "#e7f6ee" : "#fdecef", border: `1px solid ${msg.kind === "ok" ? "#b7e2c9" : "#f6c6ce"}` }}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
