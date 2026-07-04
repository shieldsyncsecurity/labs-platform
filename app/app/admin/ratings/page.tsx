import type { Metadata } from "next";
import Link from "next/link";
import { getServerUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/auth/admin";
import { engineFetch } from "@/lib/server/engine";
import { getLab } from "@/lib/labs";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic"; // reads the session cookie + live ratings

type Row = { labSlug: string; up: number; down: number; total: number; pct: number | null };

export default async function AdminRatingsPage() {
  const user = await getServerUser();
  if (!isAdmin(user)) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <h1 className="text-2xl font-extrabold text-ink">Not authorized</h1>
        <p className="mt-2 text-base text-ink-soft">This page is for ShieldSync admins.</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
          Back to dashboard
        </Link>
      </div>
    );
  }

  let labs: Row[] = [];
  let reachable = true;
  try {
    const r = await engineFetch("/ratings/summary", { method: "GET", cache: "no-store" });
    if (r.ok) labs = ((await r.json()).labs ?? []) as Row[];
    else reachable = false;
  } catch {
    reachable = false;
  }

  const totals = labs.reduce(
    (a, l) => ({ up: a.up + l.up, down: a.down + l.down }),
    { up: 0, down: 0 }
  );
  const grandTotal = totals.up + totals.down;
  const grandPct = grandTotal ? Math.round((100 * totals.up) / grandTotal) : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Admin</p>
      <h1 className="mt-1 text-2xl font-extrabold text-ink">Lab ratings</h1>
      <p className="mt-1 text-base text-ink-soft">
        Learner 👍 / 👎 after each lab. One rating per person per lab — latest wins.
      </p>

      {!reachable ? (
        <p className="mt-8 rounded-xl border border-line bg-canvas p-5 text-base text-ink-soft">
          Couldn&apos;t reach the ratings service. Try again in a moment.
        </p>
      ) : labs.length === 0 ? (
        <p className="mt-8 rounded-xl border border-line bg-canvas p-5 text-base text-ink-soft">
          No ratings yet — they&apos;ll show up here once learners start finishing labs.
        </p>
      ) : (
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
      )}
    </div>
  );
}
