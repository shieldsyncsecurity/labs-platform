"use client";

// Shared form-field primitives used by the Add-employee wizard and the edit
// form — one source so the two can never drift.
import { useState } from "react";

export const labelStyle: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };
export const inputStyle: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff", boxSizing: "border-box" };
export const groupStyle: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 14 };
export const groupTitleStyle: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#8a94a3", fontWeight: 800, marginBottom: 10 };
// auto-fit collapses to one column on narrow screens (a hard "1fr 1fr" gives
// the EA ~160px columns on a phone).
export const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 };
export const primaryBtn: React.CSSProperties = { background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
export const ghostBtn: React.CSSProperties = { background: "#fff", color: "#1f3a5f", border: "1px solid #c3cee0", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };

export function Field({ name, label, required, placeholder, defaultValue, full, type }: { name: string; label: string; required?: boolean; placeholder?: string; defaultValue?: string; full?: boolean; type?: string }) {
  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle} htmlFor={name}>
        {label} {required ? <span style={{ color: "#c0344c" }}>*</span> : null}
      </label>
      <input id={name} name={name} type={type} required={required} style={inputStyle} placeholder={placeholder} defaultValue={defaultValue} />
    </div>
  );
}

// Dropdown of predefined options + an "Other (specify)" text entry. Emits ONE
// value under `name` via a hidden input, so it drops into any FormData flow.
// A non-listed defaultValue opens in custom mode.
export function SelectOrCustom({ name, label, options, defaultValue = "", required, placeholder, full }: { name: string; label: string; options: string[]; defaultValue?: string; required?: boolean; placeholder?: string; full?: boolean }) {
  const isPreset = defaultValue !== "" && options.includes(defaultValue);
  const startCustom = defaultValue !== "" && !isPreset;
  const [mode, setMode] = useState<"preset" | "custom">(startCustom ? "custom" : "preset");
  const [sel, setSel] = useState(isPreset ? defaultValue : "");
  const [custom, setCustom] = useState(startCustom ? defaultValue : "");
  const value = mode === "custom" ? custom : sel;

  return (
    <div style={full ? { gridColumn: "1 / -1" } : undefined}>
      <label style={labelStyle} htmlFor={name}>
        {label} {required ? <span style={{ color: "#c0344c" }}>*</span> : null}
      </label>
      <input type="hidden" name={name} value={value} />
      {mode === "preset" ? (
        // `required` works here because the placeholder option has value="" —
        // without it on the VISIBLE control the red asterisk is decorative
        // (the hidden value input is exempt from constraint validation).
        <select id={name} required={required} value={sel} onChange={(e) => (e.target.value === "__custom__" ? setMode("custom") : setSel(e.target.value))} style={inputStyle}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
          <option value="__custom__">Other (specify)…</option>
        </select>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <input required={required} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={placeholder ?? "Type a custom value"} style={inputStyle} autoFocus />
          <button type="button" title="Back to list" onClick={() => { setMode("preset"); setCustom(""); }} style={{ border: "1px solid #d4dbe8", background: "#fff", borderRadius: 7, padding: "0 11px", cursor: "pointer", fontSize: 13, color: "#41506a" }}>
            ↩
          </button>
        </div>
      )}
    </div>
  );
}
