import type { Metadata } from "next";
import { RatingsTable } from "./ratings-table";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/* Deliberately a STATIC page (no session read, no engine call here): the
 * Free-plan CPU cap 1102s intermittent SSR, and a static shell costs ~0 CPU.
 * Auth + the live ratings fetch both live in /api/admin/ratings, which fails
 * closed — the table renders "Not authorized" from its 403. Same pattern as
 * /admin/labs and /admin/blog. */
export default function AdminRatingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Admin</p>
      <h1 className="mt-1 text-2xl font-bold text-ink">Lab ratings</h1>
      <p className="mt-1 text-base text-ink-soft">
        Learner 👍 / 👎 after each lab. One rating per person per lab — latest wins.
      </p>
      <RatingsTable />
    </div>
  );
}
