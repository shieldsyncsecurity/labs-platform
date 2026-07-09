"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLab } from "@/lib/labs";

type Row = { labSlug: string; up: number; down: number; total: number; pct: number | null };

export function RatingsTable() {
  const [labs, setLabs] = useState<Row[]>([]);
  const [reachable, setReachable] = useState(true);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/ratings", { cache: "no-store" });
        if (r.status === 401 || r.status === 403) {
          if (alive) { setDenied(true); setLoading(false); }
          return;
        }
        const d = (await r.json()) as { reachable?: boolean; labs?: Row[] };
        if (!alive) return;
        setReachable(d.reachable ?? false);
        setLabs(d.labs ?? []);
      } catch {
        if (alive) setReachable(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (denied) {
    return (
      <div className="mx-auto max-w-md px-5 py-8 text-center sm:py-10">
        <h2 className="text-2xl font-bold text-ink">Not authorized</h2>
        <p className="mt-2 text-base text-ink-soft">This page is for ShieldSync admins.</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (loading) {
    // Matches the loaded table's shape so there's no layout shift on arrival.
    return (
      <div className="mt-6 animate-pulse overflow-hidden rounded-xl border border-line">
        <div className="h-10 bg-canvas" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 border-t border-line bg-surface" />
        ))}
      </div>
    );
  }

  if (!reachable) {
    return (
      <p className="mt-8 rounded-xl border border-line bg-canvas p-5 text-base text-ink-soft">
        Couldn&apos;t reach the ratings service. Try again in a moment.
      </p>
    );
  }

  if (labs.length === 0) {
    return (
      <p className="mt-8 rounded-xl border border-line bg-canvas p-5 text-base text-ink-soft">
        No ratings yet — they&apos;ll show up here once learners start finishing labs.
      </p>
    );
  }

  const totals = labs.reduce((a, l) => ({ up: a.up + l.up, down: a.down + l.down }), { up: 0, down: 0 });
  const grandTotal = totals.up + totals.down;
  const grandPct = grandTotal ? Math.round((100 * totals.up) / grandTotal) : null;

  return (
    <>
      <div className="mt-6 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left">
          <thead className="bg-canvas text-sm font-semibold text-ink-soft">
            <tr>
              <th className="px-4 py-3">Lab</th>
              <th className="px-4 py-3 text-center">👍</th>
              <th className="px-4 py-3 text-center">👎</th>
              <th className="px-4 py-3 text-center">Total</th>
              <th className="px-4 py-3">Positive</th>
            </tr>
          </thead>
          <tbody className="text-base text-ink">
            {labs.map((l) => {
              const title = getLab(l.labSlug)?.title ?? l.labSlug;
              return (
                <tr key={l.labSlug} className="border-t border-line">
                  <td className="px-4 py-3 font-semibold">
                    {title}
                    {getLab(l.labSlug) ? null : <span className="ml-1 text-sm text-ink-soft">(retired)</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">{l.up}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{l.down}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{l.total}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${l.pct ?? 0}%` }} />
                      </div>
                      <span className="tabular-nums text-sm font-semibold text-ink-soft">
                        {l.pct === null ? "—" : `${l.pct}%`}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-line-strong bg-canvas text-base font-bold text-ink">
            <tr>
              <td className="px-4 py-3">All labs</td>
              <td className="px-4 py-3 text-center tabular-nums">{totals.up}</td>
              <td className="px-4 py-3 text-center tabular-nums">{totals.down}</td>
              <td className="px-4 py-3 text-center tabular-nums">{grandTotal}</td>
              <td className="px-4 py-3 tabular-nums">{grandPct === null ? "—" : `${grandPct}%`}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-4 text-sm text-ink-soft">
        Counts each learner once per lab (re-rating overwrites). Raw rows live in the
        ShieldSyncLabRatings table.
      </p>
    </>
  );
}
