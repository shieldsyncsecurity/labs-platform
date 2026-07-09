"use client";

import { useEffect, useState } from "react";

/* Client form for /admin/labs. Loads the latest committed settings via the
 * admin API (GitHub-backed), edits locally, saves = commit to both repos. */

type LabCtx = {
  slug: string;
  title: string;
  level: string;
  track: string;
  free: boolean;
  ready: boolean;
  tags: string[];
  effectiveINR: string;
  effectiveUSD: string;
};

type Setting = {
  priceINR: number | null;
  priceUSD: number | null;
  keywords: string[];
  live: boolean | null;
  free: boolean | null;
};

type Draft = {
  priceINR: string; // form strings; parsed on save
  priceUSD: string;
  keywords: string; // comma-separated
  live: "default" | "on" | "off";
  free: "default" | "on" | "off";
};

const EMPTY: Setting = { priceINR: null, priceUSD: null, keywords: [], live: null, free: null };

function toDraft(s: Setting): Draft {
  return {
    priceINR: s.priceINR == null ? "" : String(s.priceINR),
    priceUSD: s.priceUSD == null ? "" : String(s.priceUSD),
    keywords: s.keywords.join(", "),
    live: s.live == null ? "default" : s.live ? "on" : "off",
    free: s.free == null ? "default" : s.free ? "on" : "off",
  };
}

function fromDraft(d: Draft): Setting {
  return {
    priceINR: d.priceINR.trim() === "" ? null : Number(d.priceINR),
    priceUSD: d.priceUSD.trim() === "" ? null : Number(d.priceUSD),
    keywords: d.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    live: d.live === "default" ? null : d.live === "on",
    free: d.free === "default" ? null : d.free === "on",
  };
}

const inputCls =
  "w-full rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm font-medium text-ink shadow-sm outline-none placeholder:font-normal placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15";
const selectCls = inputCls + " cursor-pointer";

export function LabSettingsForm({ labs }: { labs: LabCtx[] }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState<string>("");
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; links?: string[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/lab-settings", { cache: "no-store" });
        if (r.status === 401 || r.status === 403) {
          // The page shell is static; the API is the auth gate.
          if (alive) {
            setDenied(true);
            setLoading(false);
          }
          return;
        }
        const d = (await r.json()) as { configured?: boolean; admin?: string; settings?: Record<string, Partial<Setting>>; error?: string };
        if (!alive) return;
        setConfigured(!!d.configured);
        setAdmin(d.admin ?? "");
        const next: Record<string, Draft> = {};
        for (const l of labs) {
          const s = { ...EMPTY, ...(d.settings?.[l.slug] ?? {}) } as Setting;
          next[l.slug] = toDraft(s);
        }
        setDrafts(next);
        if (d.error) setMsg({ kind: "err", text: `Loaded bundled copy — GitHub read failed: ${d.error}` });
      } catch {
        if (alive) setMsg({ kind: "err", text: "Couldn't load settings." });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [labs]);

  function patch(slug: string, p: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [slug]: { ...d[slug], ...p } }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload = { labs: Object.fromEntries(Object.entries(drafts).map(([slug, d]) => [slug, fromDraft(d)])) };
      const r = await fetch("/api/admin/lab-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = (await r.json()) as { ok?: boolean; note?: string; commits?: string[]; error?: string };
      if (r.ok && d.ok) setMsg({ kind: "ok", text: d.note ?? "Saved.", links: d.commits });
      else setMsg({ kind: "err", text: d.error ?? "Save failed." });
    } catch {
      setMsg({ kind: "err", text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-base text-muted">Loading current settings…</p>;

  if (denied) {
    return (
      <div className="max-w-md rounded-2xl border border-line bg-surface px-6 py-7 text-center shadow-sm">
        <h2 className="text-xl font-bold text-ink">Not authorized</h2>
        <p className="mt-2 text-base text-ink-soft">This panel is for ShieldSync admins. Sign in with an admin account.</p>
        <a
          href="/sign-in"
          className="mt-5 inline-block rounded-xl bg-brand px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-strong"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div>
      {/* Explicit auth proof: this chip renders only from the API's authenticated
          response — the panel must never look anonymous while showing admin data. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Signed in as admin{admin ? ` · ${admin}` : ""}
        </span>
        <span className="text-xs text-muted">{configured ? "Connected to GitHub — saves commit to both repos" : ""}</span>
      </div>

      {configured === false && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Setup needed — read-only until then.</p>
          <p className="mt-1">
            Create a fine-grained GitHub token (repos: labs-platform + shieldsync-website, permission Contents: Read &amp;
            Write), then from <span className="font-mono">labs-platform/app</span> run{" "}
            <span className="font-mono">npx wrangler secret put GITHUB_TOKEN</span> and redeploy. The panel then commits
            straight to both repos.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-canvas/70 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                <th className="px-4 py-3">Lab</th>
                <th className="px-4 py-3" title="Override in rupees. Empty = flat pricing.">Price ₹</th>
                <th className="px-4 py-3" title="Override in dollars. Empty = flat pricing.">Price $</th>
                <th className="px-4 py-3">Keywords (comma-separated)</th>
                <th className="px-4 py-3">Live</th>
                <th className="px-4 py-3">Free</th>
              </tr>
            </thead>
            <tbody>
              {labs.map((l) => {
                const d = drafts[l.slug];
                if (!d) return null;
                return (
                  <tr key={l.slug} className="border-b border-line/70 align-top last:border-b-0">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-ink">{l.title}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">
                        {l.slug} · {l.track} · {l.level}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        Now: {l.effectiveINR} / {l.effectiveUSD} · {l.ready ? "live" : "not launchable"}
                        {l.free ? " · free tier" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 w-28">
                      <input
                        className={inputCls}
                        inputMode="numeric"
                        placeholder="flat"
                        value={d.priceINR}
                        onChange={(e) => patch(l.slug, { priceINR: e.target.value })}
                        aria-label={`INR price override for ${l.title}`}
                      />
                    </td>
                    <td className="px-4 py-3.5 w-24">
                      <input
                        className={inputCls}
                        inputMode="decimal"
                        placeholder="flat"
                        value={d.priceUSD}
                        onChange={(e) => patch(l.slug, { priceUSD: e.target.value })}
                        aria-label={`USD price override for ${l.title}`}
                      />
                    </td>
                    <td className="px-4 py-3.5 min-w-[220px]">
                      <input
                        className={inputCls}
                        placeholder={l.tags.join(", ")}
                        value={d.keywords}
                        onChange={(e) => patch(l.slug, { keywords: e.target.value })}
                        aria-label={`Keywords for ${l.title}`}
                      />
                    </td>
                    <td className="px-4 py-3.5 w-28">
                      <select className={selectCls} value={d.live} onChange={(e) => patch(l.slug, { live: e.target.value as Draft["live"] })} aria-label={`Live flag for ${l.title}`}>
                        <option value="default">default</option>
                        <option value="on">live</option>
                        <option value="off">off</option>
                      </select>
                    </td>
                    <td className="px-4 py-3.5 w-28">
                      <select className={selectCls} value={d.free} onChange={(e) => patch(l.slug, { free: e.target.value as Draft["free"] })} aria-label={`Free flag for ${l.title}`}>
                        <option value="default">default</option>
                        <option value="on">free</option>
                        <option value="off">paid</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving || configured === false}
          className="rounded-xl bg-brand px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Committing…" : "Save & deploy"}
        </button>
        {msg && (
          <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-700" : "text-[#b91c1c]"}`} role="status">
            {msg.text}{" "}
            {msg.links?.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="underline">
                commit {i + 1}
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
