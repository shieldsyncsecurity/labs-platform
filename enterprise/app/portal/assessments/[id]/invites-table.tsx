"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

export type InviteRow = {
  inviteToken?: string;
  candidateName?: string;
  candidateEmail?: string;
  status?: string;
};

function StatusBadge({ status }: { status?: string }) {
  const normalized = (status ?? "unknown").toLowerCase();
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    active: "bg-brand/10 text-brand-strong",
    completed: "bg-emerald-100 text-emerald-800",
    revoked: "bg-line text-muted",
    expired: "bg-line text-muted",
  };
  const cls = styles[normalized] ?? "bg-line text-ink-soft";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {status ?? "Unknown"}
    </span>
  );
}

export default function InvitesTable({
  assessmentId,
  invites,
}: {
  assessmentId: string;
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  // Client-only: build absolute candidate links from window.location so the
  // copy button gives a URL that works from any device, not just relative.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function handleRevoke(inviteToken?: string) {
    if (!inviteToken) return;
    setError(null);
    setRevokingToken(inviteToken);
    try {
      const res = await fetch("/api/portal/invites/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken, assessmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not revoke invite.");
        setRevokingToken(null);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setRevokingToken(null);
    }
  }

  if (invites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-soft">
        No candidates added yet.
      </div>
    );
  }

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold">Candidate</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Link</th>
              <th className="px-4 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite, i) => {
              const revoked = (invite.status ?? "").toLowerCase() === "revoked";
              const link = invite.inviteToken ? `${origin}/a/${invite.inviteToken}` : "";
              return (
                <tr key={invite.inviteToken ?? i} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-3 font-medium text-ink">
                    {invite.candidateName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{invite.candidateEmail ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={invite.status} />
                  </td>
                  <td className="px-4 py-3">
                    {link ? (
                      <CopyButton value={link} label="Copy link" />
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!revoked && invite.inviteToken ? (
                      <button
                        type="button"
                        onClick={() => handleRevoke(invite.inviteToken)}
                        disabled={revokingToken === invite.inviteToken}
                        className="text-xs font-semibold text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {revokingToken === invite.inviteToken ? "Revoking…" : "Revoke"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
