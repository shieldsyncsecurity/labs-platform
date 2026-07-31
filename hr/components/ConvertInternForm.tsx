"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDisplayDate } from "./DateField";
import { labelStyle, inputStyle, gridStyle, primaryBtn } from "./fields";

export function ConvertInternForm({ seq, currentDesignation }: { seq: string; currentDesignation: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const effIso = get("effective");
    const payload = {
      designation: get("designation"),
      department: get("department"),
      grossMonthly: Number(get("gross").replace(/[, ]/g, "")) || 0,
      annualCTC: Number(get("ctc").replace(/[, ]/g, "")) || 0,
      probationMonths: Number(get("probation")) || 3,
      effectiveDate: formatDisplayDate(effIso),
    };
    if (!payload.grossMonthly || !effIso) {
      setError("Full-time gross and effective date are required.");
      setBusy(false);
      return;
    }
    if (!confirm(`Convert to full-time effective ${payload.effectiveDate}? The internship stays on record as a transition; next step issues the appointment letter.`)) {
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/employees/${seq}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not convert.");
        setBusy(false);
        return;
      }
      // Land on the employee record (not the /offer letter, which needs
      // documents:write) — a converter with employees+salary but no Letters
      // access would otherwise dead-end at /no-access. The record page surfaces
      // a gated "Generate offer" control for those who can issue it.
      router.push(`/employees/${seq}`);
      router.refresh();
    } catch {
      setError("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ border: "1px solid #e2e8f2", borderRadius: 10, padding: 16 }}>
      {error ? (
        <div style={{ background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233", fontSize: 12.5, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>{error}</div>
      ) : null}
      <div style={gridStyle}>
        <div>
          <label style={labelStyle} htmlFor="designation">Full-time designation</label>
          <input id="designation" name="designation" style={inputStyle} placeholder={currentDesignation.replace(/intern/i, "Analyst")} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="department">Department (blank = unchanged)</label>
          <input id="department" name="department" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="gross">Full-time gross monthly (INR) <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="gross" name="gross" required style={inputStyle} placeholder="30000" />
        </div>
        <div>
          <label style={labelStyle} htmlFor="ctc">Annual CTC — blank = gross × 12</label>
          <input id="ctc" name="ctc" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="effective">Effective date (full-time joining) <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="effective" name="effective" type="date" required style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="probation">Probation months (blank = 3)</label>
          <input id="probation" name="probation" type="number" min={0} max={12} style={inputStyle} placeholder="3" />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 10 }}>
        Keeps the same Employee ID. The internship is preserved as a transition on the record — issue the
        completion certificate BEFORE converting if you want it dated to the internship.
      </p>
      <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, marginTop: 8 }}>
        {busy ? "Converting…" : "Convert + issue appointment letter →"}
      </button>
    </form>
  );
}
