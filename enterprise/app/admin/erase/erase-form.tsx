"use client";

import { useState } from "react";

type Phase = "idle" | "confirm" | "working" | "done" | "error";

// Two-step (type token -> confirm -> erase) so a destructive, irreversible PII
// redaction can't happen on a single stray click. Posts to the admin-gated
// /api/admin/invites/erase route.
export default function EraseForm() {
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const trimmed = token.trim();

  async function doErase() {
    setPhase("working");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/invites/erase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhase("error");
        setMessage(data?.error ?? "Could not erase candidate data.");
        return;
      }
      setPhase("done");
      setMessage(
        data?.erasedAt
          ? `Erased. The candidate's name, email and reflection were redacted at ${data.erasedAt}.`
          : "Erased. The candidate's personal data was redacted.",
      );
      setToken("");
    } catch {
      setPhase("error");
      setMessage("Could not reach the server. Try again.");
    }
  }

  return (
    <div>
      <label htmlFor="inviteToken" className="mb-1 block text-xs font-medium text-ink-soft">
        Invite token
      </label>
      <input
        id="inviteToken"
        type="text"
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          if (phase !== "idle") {
            setPhase("idle");
            setMessage(null);
          }
        }}
        placeholder="e.g. 3f9c8a1b…"
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {phase !== "confirm" ? (
        <button
          type="button"
          disabled={!trimmed || phase === "working"}
          onClick={() => setPhase("confirm")}
          className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Erase candidate data
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <span className="text-sm text-rose-800">
            Permanently redact this candidate&apos;s data? This cannot be undone.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={doErase}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
            >
              Yes, erase
            </button>
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "working" ? <p className="mt-3 text-sm text-muted">Erasing…</p> : null}
      {phase === "done" && message ? (
        <p className="mt-3 text-sm text-emerald-700">{message}</p>
      ) : null}
      {phase === "error" && message ? (
        <p className="mt-3 text-sm text-rose-700">{message}</p>
      ) : null}
    </div>
  );
}
