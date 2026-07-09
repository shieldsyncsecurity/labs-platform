"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tiny client-side jump: agreement id -> /admin/agreements/[id]. No fetch --
// the detail page itself is the (admin-gated) source of truth and 404s on an
// unknown id.
export default function AgreementLookupForm() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (!trimmed) {
      setError("Enter an agreement id.");
      return;
    }
    setError(null);
    router.push(`/admin/agreements/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-3">
      <div className="min-w-64 flex-1">
        <input
          id="agreementLookupId"
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Agreement id"
          aria-label="Agreement id"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
      </div>
      <button
        type="submit"
        className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
      >
        Open
      </button>
    </form>
  );
}
