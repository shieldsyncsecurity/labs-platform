"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin-only: toggle whether this record exists for non-admin staff.
 * Restricted = the record vanishes from their list, pages and APIs. */
export function VisibilityControl({ seq, restricted }: { seq: number; restricted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function toggle() {
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/employees/${seq}/visibility`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restricted: !restricted }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setErr(true);
    }
    setBusy(false);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {restricted ? (
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 999, padding: "2px 10px", letterSpacing: ".03em", textTransform: "uppercase" }}>
          Administrator only
        </span>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        style={{ background: "none", border: "1px solid #d4dbe8", color: "#41506a", fontSize: 11.5, fontWeight: 600, borderRadius: 7, padding: "4px 10px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Saving…" : restricted ? "Make visible to staff" : "Restrict to administrator"}
      </button>
      {err ? <span style={{ fontSize: 11, color: "#c0344c" }}>Failed — retry</span> : null}
    </span>
  );
}
