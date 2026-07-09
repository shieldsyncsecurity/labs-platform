"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Lets staff add or remove credits from an org (delta can be negative). Only
// reachable from the org detail page, which already verified admin session
// server-side -- but the API route re-checks the admin session anyway (every
// admin/* route must, regardless of what page linked to it). The optional
// reason rides into the engine's immutable audit line (E9) so a manual
// balance change is never unexplained.
export default function AdjustCreditsForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Number(delta);
    if (!delta.trim() || !Number.isFinite(parsed) || parsed === 0) {
      setError("Enter a non-zero number (e.g. 50 or -10).");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/admin/orgs/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, delta: parsed, reason: reason.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not adjust credits.");
        setPending(false);
        return;
      }
      setDelta("");
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3">
      <div>
        <input
          id="delta"
          type="number"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          placeholder="+50 or -10"
          className="w-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
      </div>
      <input
        id="creditsReason"
        type="text"
        maxLength={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, audit trail)"
        aria-label="Reason for the adjustment (optional, goes to the audit trail)"
        className="w-64 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Applying..." : "Apply adjustment"}
      </button>
    </form>
  );
}
