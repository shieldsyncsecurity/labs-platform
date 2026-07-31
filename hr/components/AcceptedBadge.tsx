"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Shows that an offer was acknowledged online, and — for the admin — lets a
 * wrong one be voided. Before this, an acceptance existed only in an email and
 * a DynamoDB attribute, and the only way to undo one was deleting the whole
 * document (which burns its reference number). */
export function AcceptedBadge({
  seq,
  genId,
  acceptedAt,
  isAdmin,
}: {
  seq: string;
  genId: string;
  acceptedAt: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function voidAccept() {
    if (!confirm("Void this acceptance? The record of it is erased (the action itself stays in the audit trail).")) return;
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch(`/api/employees/${seq}/generated/${genId}/accept`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setErr(true);
    }
    setBusy(false);
  }

  const when = new Date(acceptedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
      <span
        title={`Acknowledged online on ${when}`}
        style={{ fontSize: 10.5, fontWeight: 800, color: "#146c3c", background: "#e7f6ee", border: "1px solid #b7e2c9", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}
      >
        Accepted {when}
      </span>
      {isAdmin ? (
        <button
          type="button"
          onClick={voidAccept}
          disabled={busy}
          style={{ background: "none", border: "none", color: "#c0344c", fontSize: 11, fontWeight: 600, cursor: busy ? "default" : "pointer", padding: 0 }}
        >
          {busy ? "…" : "Void"}
        </button>
      ) : null}
      {err ? <span style={{ fontSize: 10.5, color: "#c0344c" }}>failed</span> : null}
    </span>
  );
}
