"use client";

import { useCallback, useEffect, useState } from "react";

/** Portal seats for one employer org.
 *
 *  WHY THIS EXISTS: creating the Cognito user is NOT what grants portal access.
 *  auth/callback checks the custom:orgId claim against the membership record
 *  written here, and denies the session if there is no match — so a Cognito
 *  attribute alone (however it got set) can never open someone else's tenant.
 *  Onboarding an employer is therefore two steps, and this is the second one.
 */

type Member = { sub: string; orgId: string; email?: string; createdAt?: string; createdBy?: string };

export default function SeatsSection({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [sub, setSub] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/members?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { members?: Member[] };
      setMembers(Array.isArray(d.members) ? d.members : []);
    } catch {
      setMembers([]);
      setMsg({ kind: "err", text: "Could not load seats." });
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function bind(e: React.FormEvent) {
    e.preventDefault();
    const s = sub.trim();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sub: s, orgId, email: email.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "failed");
      }
      setSub("");
      setEmail("");
      setMsg({ kind: "ok", text: "Seat granted. That user can now open this org's portal." });
      await load();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Could not grant the seat." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(s: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sub: s, action: "revoke" }),
      });
      if (!res.ok) throw new Error();
      setMsg({ kind: "ok", text: "Seat revoked. Their next sign-in fails closed." });
      await load();
    } catch {
      setMsg({ kind: "err", text: "Could not revoke the seat." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-soft">Portal seats</h2>
        <span className="font-mono text-xs text-muted">
          {members === null ? "loading…" : `${members.length} seat${members.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Creating the Cognito user does <strong className="text-ink-soft">not</strong> grant access on its own.
        A seat must be bound here — sign-in is denied unless the token&rsquo;s org matches this record.
      </p>

      <form onSubmit={bind} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-56">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Cognito subject (sub)</span>
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            placeholder="e.g. 5468d4e8-9011-70d5-…"
            className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 font-mono text-xs text-ink outline-none focus:border-brand"
          />
        </label>
        <label className="flex-1 min-w-48">
          <span className="mb-1 block text-xs font-medium text-ink-soft">Email (label only)</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@company.com"
            className="w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-xs text-ink outline-none focus:border-brand"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !sub.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          Grant seat
        </button>
      </form>

      {msg ? (
        <p className={`mt-3 text-xs font-medium ${msg.kind === "ok" ? "text-emerald-700" : "text-rose-700"}`}>
          {msg.text}
        </p>
      ) : null}

      <div className="mt-4">
        {members && members.length > 0 ? (
          <ul className="overflow-hidden rounded-xl border border-line">
            {members.map((m) => (
              <li key={m.sub} className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{m.email || "(no email recorded)"}</div>
                  <div className="truncate font-mono text-[11px] text-muted">{m.sub}</div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(m.sub)}
                  disabled={busy}
                  className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-semibold text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : members ? (
          <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-xs text-muted">
            No seats yet — nobody can open this org&rsquo;s portal.
          </p>
        ) : null}
      </div>
    </section>
  );
}
