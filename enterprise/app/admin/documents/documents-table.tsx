"use client";

import { useState } from "react";

// Client table for the staff documents list. Rows carry DISPLAY ids only; the
// resend/revoke actions post that id and the server resolves it back to the
// token (app/api/admin/documents/action).

export type DocRow = {
  id: string;
  title: string;
  fileName: string;
  signerName: string;
  signerEmail: string;
  note: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedName?: string;
};

function fmtDate(iso: string | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StatusBadge({ status, expiresAt }: { status: string; expiresAt: string }) {
  const expired = status === "pending" && expiresAt && new Date(expiresAt) < new Date();
  if (status === "signed") {
    return (
      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        Signed
      </span>
    );
  }
  if (status === "revoked") {
    return (
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
        Revoked
      </span>
    );
  }
  if (expired) {
    return (
      <span className="inline-flex rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
        Expired
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
      Pending
    </span>
  );
}

export default function DocumentsTable({ initialDocs }: { initialDocs: DocRow[] }) {
  const [docs, setDocs] = useState(initialDocs);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function act(id: string, action: "resend" | "revoke") {
    if (busyId) return;
    if (action === "revoke" && !window.confirm("Revoke this signing link? The signer will no longer be able to open or accept it.")) {
      return;
    }
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch("/api/admin/documents/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        emailed?: boolean;
        code?: string;
        retryAfter?: number;
        error?: string;
      };
      if (res.ok && action === "revoke") {
        setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, status: "revoked" } : d)));
        setNote(`Link ${id} revoked.`);
      } else if (res.ok && action === "resend") {
        setNote(
          data.emailed
            ? `Signing-link email re-sent for ${id}.`
            : `Re-send for ${id} was accepted but the email did not deliver (SES sandbox: recipient must be verified).`,
        );
      } else if (data.code === "RESEND_COOLDOWN") {
        setNote(`Please wait ${data.retryAfter ?? 45}s between re-sends.`);
      } else if (data.code === "ALREADY_SIGNED") {
        setNote("That document has already been signed.");
      } else if (data.code === "NOT_REVOCABLE") {
        setNote("A signed record cannot be revoked.");
      } else if (data.code === "LINK_EXPIRED") {
        setNote("That link has expired; register the document again if it's still needed.");
      } else {
        setNote(data.error ?? "Action failed.");
      }
    } catch {
      setNote("Action failed. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (docs.length === 0) {
    return (
      <p className="mt-8 rounded-lg border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
        No documents yet. Register the first one to get a signing link.
      </p>
    );
  }

  return (
    <div className="mt-6">
      {note ? (
        <p className="mb-3 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-ink-soft" role="status">
          {note}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold">Id</th>
              <th className="px-4 py-3 font-semibold">Document</th>
              <th className="px-4 py-3 font-semibold">Signer</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Registered</th>
              <th className="px-4 py-3 font-semibold">Signed / expires</th>
              <th className="px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-b-0 align-top">
                <td className="px-4 py-3 font-mono text-xs text-muted">{d.id}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{d.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {d.fileName} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                  </p>
                  {d.note ? <p className="mt-0.5 text-xs italic text-muted">{d.note}</p> : null}
                </td>
                <td className="px-4 py-3">
                  <p className="text-ink-soft">{d.signerName || "-"}</p>
                  <p className="text-xs text-muted">{d.signerEmail}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={d.status} expiresAt={d.expiresAt} />
                </td>
                <td className="px-4 py-3 text-xs text-muted">{fmtDate(d.createdAt)}</td>
                <td className="px-4 py-3 text-xs text-muted">
                  {d.status === "signed" ? (
                    <>
                      {fmtDate(d.acceptedAt)}
                      {d.acceptedName ? <span className="block">{d.acceptedName}</span> : null}
                    </>
                  ) : d.status === "pending" ? (
                    <>expires {fmtDate(d.expiresAt)}</>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3">
                  {d.status === "signed" ? (
                    <a
                      href={`/api/admin/documents/certificate?id=${d.id}`}
                      className="text-xs font-semibold text-brand-strong underline hover:no-underline"
                    >
                      Certificate (PDF)
                    </a>
                  ) : d.status === "pending" ? (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => act(d.id, "resend")}
                        disabled={busyId !== null}
                        className="text-left text-xs font-semibold text-brand-strong underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busyId === d.id ? "Working…" : "Resend link email"}
                      </button>
                      <button
                        type="button"
                        onClick={() => act(d.id, "revoke")}
                        disabled={busyId !== null}
                        className="text-left text-xs font-semibold text-red-600 underline hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Revoke link
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
