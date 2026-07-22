"use client";

import { useState } from "react";

/** "2026-03-02" -> "2 March 2026" (the letterhead date style). */
export function formatDisplayDate(iso: string): string {
  const [y, m, d] = (iso || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  const month = new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long" });
  return `${d} ${month} ${y}`;
}

/** Best-effort parse of a display date back to YYYY-MM-DD (for edit prefill). */
export function toISODate(display: string): string {
  if (!display) return "";
  const d = new Date(display);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff", boxSizing: "border-box" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };

// Calendar picker that emits the letterhead-formatted date ("2 March 2026")
// under `name`, so it drops into the FormData flow. Shows the formatted value
// beneath for confirmation.
export function DateField({ name, label, required, defaultValue }: { name: string; label: string; required?: boolean; defaultValue?: string }) {
  const [iso, setIso] = useState(defaultValue ? toISODate(defaultValue) : "");
  const display = iso ? formatDisplayDate(iso) : defaultValue ?? "";

  return (
    <div>
      <label style={labelStyle} htmlFor={name}>
        {label} {required ? <span style={{ color: "#c0344c" }}>*</span> : null}
      </label>
      <input type="hidden" name={name} value={display} />
      <input id={name} type="date" value={iso} onChange={(e) => setIso(e.target.value)} style={input} />
      {display ? <div style={{ fontSize: 10.5, color: "#8a94a3", marginTop: 3 }}>→ {display}</div> : null}
    </div>
  );
}
