"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Candidate, Interview } from "@/lib/candidate";
import { DEFAULT_DURATION_MINUTES, DURATION_OPTIONS, formatIST, instantToIstParts, istToInstant, scheduleWarnings, todayIST } from "@/lib/scheduling";
import { ghostBtn, primaryBtn, inputStyle, labelStyle } from "./fields";

const card: React.CSSProperties = { border: "1px solid #e2e8f2", borderRadius: 10, padding: 16, marginTop: 16 };
const title: React.CSSProperties = { fontWeight: 700, color: "#1f3a5f", fontSize: 14 };

type Proposal = {
  candidateSeq: number;
  candidateName: string;
  candidateEmail: string;
  role: string;
  startsAt: string;
  whenLabel: string;
  durationMinutes: number;
  round?: string;
  panel?: string;
  sendInvite: boolean;
  warnings: string[];
};

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Schedule interviews, by sentence or by form.
 *
 * The assistant NEVER books anything itself — it returns a proposal, this
 * component renders it, and only an explicit click calls the booking endpoint.
 * An interview invite can't be unsent, so the confirmation step is the feature,
 * not friction around it.
 */
export function InterviewScheduler({ candidate, teamsConnected }: { candidate: Candidate; teamsConnected: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const interviews = candidate.interviews ?? [];

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setErr(null);
    setProposal(null);
    const history = turns.slice(-8);
    setTurns((t) => [...t, { role: "user", content: message }]);
    setDraft("");
    try {
      // A stalled model response with no timeout would leave `busy` stuck
      // true forever — the whole scheduling chat becomes unusable until a
      // page reload. 30s is generous for a chat reply but bounds the wait.
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, history }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "The assistant couldn't respond.");
      } else {
        setTurns((t) => [...t, { role: "assistant", content: data.reply }]);
        setProposal(data.proposal ?? null);
      }
    } catch (err) {
      setErr(err instanceof DOMException && err.name === "TimeoutError" ? "The assistant took too long to respond — try again." : "Could not reach the server.");
    }
    setBusy(false);
  }

  /** The only path that books anything — reached by an explicit click. */
  async function book(p: {
    startsAt: string;
    durationMinutes: number;
    round?: string;
    panel?: string;
    sendInvite: boolean;
    meetingUrl?: string;
  }) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}/interviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Could not schedule it.");
      } else {
        setProposal(null);
        setShowForm(false);
        setTurns((t) => [...t, { role: "assistant", content: `Scheduled — ${data.summary}` }]);
        router.refresh();
      }
    } catch {
      setErr("Could not reach the server.");
    }
    setBusy(false);
  }

  async function cancel(iv: Interview) {
    if (!confirm(`Cancel the interview on ${formatIST(iv.startsAt)}?\n\n${iv.invitedAt ? "The candidate will be notified by Outlook." : "No invite was sent, so nobody is notified."}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/candidates/${candidate.seq}/interviews/${iv.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErr(data.error ?? "Could not cancel it.");
      else if (data.warning) setErr(data.warning);
      router.refresh();
    } catch {
      setErr("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={title}>Interviews</div>
        {!teamsConnected ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8a5a00", background: "#fdf4e3", border: "1px solid #f0d9a8", borderRadius: 999, padding: "2px 9px" }}>
            Teams not connected — paste a meeting link
          </span>
        ) : null}
      </div>

      {/* --- Scheduled rounds --- */}
      {interviews.length > 0 ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {interviews.map((iv) => {
            const past = new Date(iv.startsAt).getTime() < Date.now();
            return (
              <div
                key={iv.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  border: "1px solid #e2e8f2", borderRadius: 8, padding: "9px 12px",
                  background: past ? "#fafbfd" : "#fff",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: past ? "#8a94a3" : "#1b2331" }}>{formatIST(iv.startsAt)}</div>
                <div style={{ fontSize: 12, color: "#5b6676" }}>
                  {iv.durationMinutes} min{iv.round ? ` · ${iv.round}` : ""}{iv.panel ? ` · ${iv.panel}` : ""}
                </div>
                {iv.invitedAt ? (
                  <span style={{ fontSize: 11, color: "#146c3c", fontWeight: 700 }}>invite sent</span>
                ) : (
                  <span style={{ fontSize: 11, color: "#8a5a00", fontWeight: 700 }}>hold only</span>
                )}
                <div style={{ flex: 1 }} />
                {iv.meetingUrl && /^https?:\/\//i.test(iv.meetingUrl) ? (
                  <a href={iv.meetingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#2f4fb0", fontWeight: 700 }}>
                    Join
                  </a>
                ) : null}
                {!past ? (
                  <button type="button" onClick={() => cancel(iv)} disabled={busy} style={{ background: "none", border: "none", color: "#c0344c", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    Cancel
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: "#8a94a3", margin: "8px 0 0" }}>No interviews scheduled yet.</p>
      )}

      {/* --- Conversation --- */}
      {turns.length > 0 ? (
        <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
          {turns.slice(-6).map((t, i) => (
            <div
              key={i}
              style={{
                fontSize: 12.5, lineHeight: 1.5, padding: "7px 11px", borderRadius: 8, maxWidth: "90%",
                justifySelf: t.role === "user" ? "end" : "start",
                background: t.role === "user" ? "#eef2f8" : "#f6f8fc",
                color: "#1b2331",
              }}
            >
              {t.content}
            </div>
          ))}
        </div>
      ) : null}

      {/* --- Proposal: the only thing that can become a booking --- */}
      {proposal ? (
        <div style={{ marginTop: 12, border: "1px solid #c3d8f0", background: "#f4f9ff", borderRadius: 10, padding: "13px 15px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#2f4fb0", textTransform: "uppercase", letterSpacing: ".06em" }}>
            Confirm before sending
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1b2331", marginTop: 6 }}>{proposal.whenLabel}</div>
          <div style={{ fontSize: 12.5, color: "#41506a", marginTop: 3, lineHeight: 1.55 }}>
            {proposal.durationMinutes} minutes with <b>{proposal.candidateName}</b> ({proposal.role})
            {proposal.round ? ` · ${proposal.round}` : ""}
            {proposal.panel ? ` · panel: ${proposal.panel}` : ""}
            <br />
            {proposal.sendInvite ? (
              <>A Teams invite will be emailed to <b>{proposal.candidateEmail}</b>.</>
            ) : (
              <>Calendar hold only — the candidate will <b>not</b> be told.</>
            )}
          </div>
          {proposal.warnings.length ? (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "#8a5a00" }}>
              {proposal.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div style={{ marginTop: 11, display: "flex", gap: 9 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                book({
                  startsAt: proposal.startsAt,
                  durationMinutes: proposal.durationMinutes,
                  round: proposal.round,
                  panel: proposal.panel,
                  sendInvite: proposal.sendInvite,
                })
              }
              style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "Sending…" : proposal.sendInvite ? "Send invite" : "Create hold"}
            </button>
            <button type="button" onClick={() => setProposal(null)} disabled={busy} style={ghostBtn}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 10, fontSize: 12.5, padding: "8px 11px", borderRadius: 8, background: "#fdecef", border: "1px solid #f6c6ce", color: "#9a2233" }}>
          {err}
        </div>
      ) : null}

      {/* --- Ask --- */}
      <form onSubmit={ask} style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`e.g. "interview ${candidate.name.split(" ")[0]} Tuesday 3pm"`}
          disabled={busy}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="submit" disabled={busy || !draft.trim()} style={{ ...primaryBtn, opacity: busy || !draft.trim() ? 0.5 : 1 }}>
          Ask
        </button>
      </form>

      <button
        type="button"
        onClick={() => setShowForm((s) => !s)}
        style={{ background: "none", border: "none", color: "#2f4fb0", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 0 0" }}
      >
        {showForm ? "Hide the form" : "Or fill in a form instead"}
      </button>

      {showForm ? <ManualForm teamsConnected={teamsConnected} busy={busy} onBook={book} /> : null}
    </div>
  );
}

/** Deterministic path — no model involved. Also the only way to schedule when
 *  Teams isn't connected, since the link has to be pasted by hand. */
function ManualForm({
  teamsConnected,
  busy,
  onBook,
}: {
  teamsConnected: boolean;
  busy: boolean;
  onBook: (p: { startsAt: string; durationMinutes: number; round?: string; panel?: string; sendInvite: boolean; meetingUrl?: string }) => void;
}) {
  const [date, setDate] = useState(todayIST());
  const [time, setTime] = useState("15:00");
  const [duration, setDuration] = useState(DEFAULT_DURATION_MINUTES);
  const [round, setRound] = useState("");
  const [panel, setPanel] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [sendInvite, setSendInvite] = useState(true);

  const instant = istToInstant(date, time);
  const warnings = instant ? scheduleWarnings(instant) : ["That date and time couldn't be read."];

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid #eef2f7", paddingTop: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div>
          <label style={labelStyle} htmlFor="ivdate">Date (IST)</label>
          <input id="ivdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="ivtime">Time (IST)</label>
          <input id="ivtime" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="ivdur">Length</label>
          <select id="ivdur" value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={inputStyle}>
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={labelStyle} htmlFor="ivround">Round</label>
          <input id="ivround" value={round} onChange={(e) => setRound(e.target.value)} placeholder="Screening" style={inputStyle} />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label style={labelStyle} htmlFor="ivpanel">Who&rsquo;s interviewing</label>
          <input id="ivpanel" value={panel} onChange={(e) => setPanel(e.target.value)} placeholder="Himanshu Jain" style={inputStyle} />
        </div>
      </div>
      {!teamsConnected ? (
        <div>
          <label style={labelStyle} htmlFor="ivurl">Meeting link</label>
          <input id="ivurl" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="Paste the Teams link from Outlook" style={inputStyle} />
          <div style={{ fontSize: 11, color: "#8a94a3", marginTop: 4 }}>
            Create the meeting in Outlook, then paste its join link here so it&rsquo;s on the candidate&rsquo;s record.
          </div>
        </div>
      ) : null}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "#41506a" }}>
        <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
        Email the candidate an invite {sendInvite ? "" : "— off, this will be a private hold"}
      </label>
      {instant ? (
        <div style={{ fontSize: 12.5, color: "#1f3a5f", fontWeight: 600 }}>{formatIST(instant)}</div>
      ) : null}
      {warnings.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#8a5a00" }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      <div>
        <button
          type="button"
          disabled={busy || !instant}
          onClick={() => instant && onBook({ startsAt: instant, durationMinutes: duration, round: round.trim() || undefined, panel: panel.trim() || undefined, sendInvite, meetingUrl: meetingUrl.trim() || undefined })}
          style={{ ...primaryBtn, opacity: busy || !instant ? 0.5 : 1 }}
        >
          {sendInvite ? "Schedule and send invite" : "Create hold"}
        </button>
      </div>
    </div>
  );
}
