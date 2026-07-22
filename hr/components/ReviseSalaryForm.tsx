"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDisplayDate } from "./DateField";

const label: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 700, color: "#41506a", marginBottom: 4 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #d4dbe8", borderRadius: 7, background: "#fff", boxSizing: "border-box" };

export function ReviseSalaryForm({ seq, currentGross }: { seq: string; currentGross: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const gross = Number(String(fd.get("gross") ?? "").replace(/[, ]/g, "")) || 0;
    const ctc = Number(String(fd.get("ctc") ?? "").replace(/[, ]/g, "")) || 0;
    const effIso = String(fd.get("effective") ?? "");
    const reason = String(fd.get("reason") ?? "").trim();

    if (gross <= 0 || !effIso) {
      setError("New gross and effective date are required.");
      setBusy(false);
      return;
    }
    if (gross === currentGross) {
      setError("New gross equals the current gross — nothing to revise.");
      setBusy(false);
      return;
    }
    if (!confirm(`Apply the revision to ${formatDisplayDate(effIso)} and issue the Salary Revision Letter?`)) {
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/api/employees/${seq}/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grossMonthly: gross, annualCTC: ctc, effectiveDate: formatDisplayDate(effIso), reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not apply the revision.");
        setBusy(false);
        return;
      }
      router.push(data.genId ? `/employees/${seq}/issued/${data.genId}` : `/employees/${seq}`);
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={label} htmlFor="gross">New gross monthly (INR) <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="gross" name="gross" required style={input} placeholder="e.g. 40000" />
        </div>
        <div>
          <label style={label} htmlFor="ctc">New annual CTC — blank = gross × 12</label>
          <input id="ctc" name="ctc" style={input} placeholder="e.g. 480000" />
        </div>
        <div>
          <label style={label} htmlFor="effective">Effective date <span style={{ color: "#c0344c" }}>*</span></label>
          <input id="effective" name="effective" type="date" required style={input} />
        </div>
        <div>
          <label style={label} htmlFor="reason">Reason (appears in the letter)</label>
          <input id="reason" name="reason" style={input} placeholder="your performance and contribution" />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#8a94a3", marginTop: 10 }}>
        The new structure auto-splits (Basic 50%, HRA 40% of Basic, Conveyance ₹1,600, Special = balance). The
        previous compensation is preserved in the record’s history.
      </p>
      <button
        type="submit"
        disabled={busy}
        style={{ background: "#1f3a5f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, marginTop: 8 }}
      >
        {busy ? "Applying…" : "Apply revision + issue letter"}
      </button>
    </form>
  );
}
