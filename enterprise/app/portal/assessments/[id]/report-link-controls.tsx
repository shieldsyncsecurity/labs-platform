"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

// Full-report link card with its lifecycle controls (revoke / renew). The
// revoked/expired state comes from the server-rendered assessment fields
// (reportRevokedAt / reportExpiresAt) -- after an action we router.refresh()
// so the card re-renders from engine truth, never from optimistic state.
//
// Renew re-arms the SAME url (engine contract), which is why the revoked
// copy explicitly tells the employer to leave a leaked link revoked.

function fmtDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function ReportLinkControls({
  assessmentId,
  reportLink,
  revokedAt,
  expiresAt,
}: {
  assessmentId: string;
  reportLink: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"revoke" | "renew" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoked = Boolean(revokedAt);
  const expired =
    !revoked && Boolean(expiresAt) && new Date(expiresAt as string).getTime() < Date.now();
  const dead = revoked || expired;

  async function run(action: "revoke" | "renew") {
    setError(null);
    setPending(action);
    try {
      const res = await fetch(`/api/portal/report/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Could not ${action} the link.`);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-soft">Full report link</h2>
        {dead ? (
          <button
            type="button"
            onClick={() => run("renew")}
            disabled={pending !== null}
            className="text-xs font-semibold text-brand-strong hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === "renew" ? "Renewing..." : "Renew link (90 days)"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run("revoke")}
            disabled={pending !== null}
            className="text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === "revoke" ? "Revoking..." : "Revoke link"}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted">
        Share this with your hiring team {"\u2014"} the side-by-side comparison of every
        candidate for this assessment, updated live as they submit.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className={`min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs ${
            dead ? "text-muted line-through" : "text-ink-soft"
          }`}
        >
          {reportLink}
        </span>
        {dead ? null : <CopyButton value={reportLink} label="Copy link" />}
      </div>

      {revoked ? (
        <p className="mt-2 text-xs text-muted">
          Link revoked {"\u2014"} renew to re-enable. Renewing re-arms this same URL, so if
          it leaked, keep it revoked.
        </p>
      ) : expired ? (
        <p className="mt-2 text-xs text-muted">
          Link expired{expiresAt ? ` on ${fmtDate(expiresAt)}` : ""} {"\u2014"} renew to
          re-enable it for another 90 days.
        </p>
      ) : expiresAt ? (
        <p className="mt-2 text-xs text-muted">Valid until {fmtDate(expiresAt)}.</p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
