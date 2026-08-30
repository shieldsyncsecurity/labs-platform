"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Destructive: deleting an employee cascades their KYC documents. Requires an
// explicit confirm; the deletion is written to the audit trail by the engine.
export function DeleteEmployeeButton({ seq, name, employeeId }: { seq: string; name: string; employeeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete ${name} (${employeeId})?\n\nThis permanently removes the employee record AND all their KYC documents. This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/employees/${seq}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Could not delete the employee.");
        setBusy(false);
        return;
      }
      router.push("/employees");
      router.refresh();
    } catch {
      alert("Could not reach the server — check the connection and try again.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      // Deliberately understated (quiet danger-text, not a framed button) — a
      // rare irreversible action shouldn't out-shout the everyday Edit control
      // beside it. The confirm dialog is the real guard.
      style={{ background: "none", border: "none", color: "#9a2233", padding: "7px 6px", fontSize: 12.5, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
