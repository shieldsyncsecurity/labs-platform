"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

// Adds a candidate to an assessment. On success shows the freshly-generated
// candidate link right here (so the employer can copy it immediately) and
// then refreshes the server-rendered invites table below.
export default function AddCandidateForm({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNewLink(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Enter both a candidate name and email.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          candidateName: trimmedName,
          candidateEmail: trimmedEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not create invite.");
        setPending(false);
        return;
      }

      const inviteToken = data?.invite?.inviteToken ?? data?.inviteToken;
      if (inviteToken) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setNewLink(`${origin}/a/${inviteToken}`);
      }
      setName("");
      setEmail("");
      setPending(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="candidateName" className="mb-1 block text-xs font-medium text-ink-soft">
            Candidate name
          </label>
          <input
            id="candidateName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="candidateEmail" className="mb-1 block text-xs font-medium text-ink-soft">
            Candidate email
          </label>
          <input
            id="candidateEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add candidate"}
        </button>
      </form>

      <p className="mt-2 text-xs text-muted">Each invite uses 1 credit.</p>

      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}

      {newLink ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-emerald-800">Candidate link ready — send it yourself:</p>
            <p className="truncate font-mono text-xs text-emerald-900">{newLink}</p>
          </div>
          <CopyButton value={newLink} label="Copy link" />
        </div>
      ) : null}
    </div>
  );
}
