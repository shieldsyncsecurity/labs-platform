"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Acceptance action for an issued agreement. The checkbox is the authority
// attestation -- the Accept button stays disabled until it is ticked. The
// server route re-verifies org ownership; this component only handles UX.
export default function AcceptAgreementForm({
  agreementId,
  companyLegalName,
}: {
  agreementId: string;
  companyLegalName: string;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    if (!authorized) {
      setError("Confirm you are authorized to accept this agreement first.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/portal/agreements/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agreementId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not record your acceptance. Try again.");
        setPending(false);
        return;
      }
      router.push("/portal/agreements");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={authorized}
          onChange={(e) => setAuthorized(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/40"
        />
        <span className="text-sm text-ink-soft">
          I am authorized to bind <span className="font-semibold text-ink">{companyLegalName}</span>{" "}
          to this agreement, and I accept its terms on the company&apos;s behalf.
        </span>
      </label>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      <button
        type="button"
        onClick={handleAccept}
        disabled={pending || !authorized}
        className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Recording acceptance..." : "Accept agreement"}
      </button>
    </div>
  );
}
