"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Candidate } from "@/lib/candidate";

/**
 * Inline send/resend, right in the candidates list row. Before this, sending
 * the questionnaire link meant clicking into the candidate's own page and
 * scrolling to find the button — an extra hop for the single most common
 * action on this list. Nothing here needs a detail page: it's the same POST
 * /api/candidates/[seq]/send the detail page uses, just reachable in one
 * click from where you're already looking at everyone.
 */
export function CandidateRowActions({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Once they've answered, there's nothing left to send — the row already
  // shows "✓ Submitted"; reviewing their answers is a real drill-down (there's
  // a lot of content), so that stays a click into their page, not a row button.
  if (candidate.submittedAt) return null;

  async function send() {
    if (candidate.questionnaireSentAt && !confirm(`Re-sending creates a new link for ${candidate.name} and invalidates the old one. Continue?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ send: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Could not send.");
      } else if (data.warning) {
        setMsg(data.warning);
      } else {
        setMsg(data.simulated ? "Sent (simulated in dev) ✓" : "Sent ✓");
        router.refresh();
      }
    } catch {
      setMsg("Could not reach the server.");
    }
    setBusy(false);
  }

  const alreadySent = Boolean(candidate.questionnaireSentAt);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
      {msg ? <span style={{ fontSize: 11, color: "#5b6676", textAlign: "right" }}>{msg}</span> : null}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        style={{
          background: alreadySent ? "#fff" : "#1f3a5f",
          color: alreadySent ? "#1f3a5f" : "#fff",
          border: alreadySent ? "1px solid #c3cee0" : "none",
          borderRadius: 7,
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 700,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Sending…" : alreadySent ? "Resend" : "Send link"}
      </button>
    </div>
  );
}
