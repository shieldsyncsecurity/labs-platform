"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Dev sign-in form. Purely a placeholder for real SSO (Cognito) -- see
// lib/server/portal-session.ts and app/api/portal/dev-login/route.ts for the
// TODOs. Kept as a client component only because it needs local state for
// the pending/error UI; it holds no secrets and does not read the session
// cookie itself (that's httpOnly, server-only).
export default function DevLoginForm() {
  const router = useRouter();
  const [orgId, setOrgId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = orgId.trim();
    if (!trimmed) {
      setError("Enter an org id.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/portal/dev-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Sign-in failed.");
        setPending(false);
        return;
      }
      router.push("/portal");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="orgId" className="mb-1 block text-sm font-medium text-ink-soft">
          Org ID
        </label>
        <input
          id="orgId"
          name="orgId"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          placeholder="e.g. org_8f2a1c"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
