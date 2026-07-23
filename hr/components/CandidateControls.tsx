"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OUTCOME_OPTIONS, type Candidate, type CandidateOutcome } from "@/lib/candidate";
import { ghostBtn, primaryBtn, inputStyle, labelStyle } from "./fields";

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16 };
const title: React.CSSProperties = { fontWeight: 700, color: "#1f3a5f", fontSize: 14 };

/** Send (or re-send) the questionnaire link, and surface the raw link for
 * copy/paste — HR often prefers WhatsApp. */
export function SendQuestionnaire({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [to, setTo] = useState(candidate.email);

  const alreadySent = Boolean(candidate.questionnaireSentAt);

  async function go(send: boolean) {
    if (alreadySent && send && !confirm("Re-sending creates a NEW link and immediately invalidates the old one. Continue?")) return;
    setBusy(true);
    setState(null);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, send }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState(data.error ?? "Could not create the link.");
        setBusy(false);
        return;
      }
      setLink(data.link);
      setState(
        data.warning ??
          (data.sent
            ? data.simulated
              ? "Link created. Email simulated (no RESEND_API_KEY in dev) — copy it below."
              : `Emailed to ${to} ✓`
            : "Link created — copy it below."),
      );
      router.refresh();
    } catch {
      setState("Could not reach the server.");
    }
    setBusy(false);
  }

  if (candidate.submittedAt) {
    return (
      <div style={card}>
        <div style={title}>Questionnaire</div>
        <p style={{ fontSize: 12.5, color: "#1a7a45", fontWeight: 600, marginTop: 6 }}>
          ✓ Submitted on {new Date(candidate.submittedAt).toLocaleString("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} — responses below.
        </p>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={title}>Questionnaire link</div>
      <p style={{ fontSize: 12, color: "#5b6676", margin: "5px 0 12px", lineHeight: 1.55 }}>
        {alreadySent
          ? `Sent to ${candidate.questionnaireSentTo} on ${new Date(candidate.questionnaireSentAt!).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} — not submitted yet.`
          : "Emails the candidate a private, expiring link to the detailed questionnaire."}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle} htmlFor="qto">Send to</label>
          <input id="qto" type="email" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 4 }}>The link is valid for 36 hours after we send it.</div>
        </div>
        <button type="button" onClick={() => go(true)} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Working…" : alreadySent ? "Re-send link" : "Email the link"}
        </button>
        <button type="button" onClick={() => go(false)} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} title="Create the link without sending an email">
          Just give me the link
        </button>
      </div>

      {state ? <div style={{ fontSize: 12.5, color: "#1f3a5f", fontWeight: 600, marginTop: 10 }}>{state}</div> : null}
      {link ? (
        <div style={{ marginTop: 8 }}>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            style={{ ...inputStyle, fontFamily: "monospace", fontSize: 11.5, background: "#f8fafc" }}
          />
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(link).then(() => setState("Link copied to clipboard ✓"))}
            style={{ ...ghostBtn, marginTop: 6, padding: "6px 12px", fontSize: 12 }}
          >
            Copy link
          </button>
          <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 6 }}>
            Anyone with this link can fill the form for this candidate — share it only with them.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OutcomeControl({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CandidateOutcome>(candidate.outcome);
  const [note, setNote] = useState(candidate.outcomeNote ?? "");

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...candidate, outcome, outcomeNote: note }),
      });
      if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "Could not save.");
      else router.refresh();
    } catch {
      alert("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div style={card}>
      <div style={title}>Decision</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
        <div style={{ minWidth: 200 }}>
          <label style={labelStyle} htmlFor="outcome">Outcome</label>
          <select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as CandidateOutcome)} style={inputStyle}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle} htmlFor="outcomeNote">Note (internal)</label>
          <input id="outcomeNote" value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} placeholder="Why, in one line" />
        </div>
        <button type="button" onClick={save} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Save decision"}
        </button>
      </div>
    </div>
  );
}

/** Real erasure — the DPDP right the candidate is promised on the form. */
export function DeleteCandidateButton({ candidate }: { candidate: Candidate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Permanently delete ${candidate.name} (${candidate.candidateId}) and all their questionnaire responses?\n\nThis cannot be undone. The deletion is logged.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}`, { method: "DELETE" });
      if (!res.ok) {
        alert((await res.json().catch(() => ({}))).error ?? "Could not delete.");
        setBusy(false);
        return;
      }
      router.push("/candidates");
      router.refresh();
    } catch {
      alert("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={onDelete} disabled={busy} style={{ background: "none", border: "none", color: "#c0344c", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
      {busy ? "Deleting…" : "Delete candidate + responses"}
    </button>
  );
}
