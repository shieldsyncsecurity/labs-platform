"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Two-step delete for an org. Only rendered as actionable when the org is empty
// (no assessments) -- otherwise it explains why it's blocked. On success it
// bounces back to the org list.
export default function DeleteOrgButton({
  orgId,
  orgName,
  canDelete,
}: {
  orgId: string;
  orgName: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orgs/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not delete organization.");
        setBusy(false);
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(false);
    }
  }

  if (!canDelete) {
    return (
      <p className="text-xs text-muted">
        Organizations with assessments can&apos;t be deleted &mdash; candidate results are retained
        under the data-retention policy.
      </p>
    );
  }

  return (
    <div>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
        >
          Delete organization
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-soft">
            Delete <span className="font-semibold text-ink">{orgName}</span> permanently?
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-surface disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
