import type { Metadata } from "next";
import { LABS } from "@/lib/labs";
import { priceFor, formatMoney } from "@/lib/payments/pricing";
import { LabSettingsForm } from "./settings-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/* Admin panel: per-lab prices / keywords / flags. Edits are committed to git
 * (both repos) via the API route, and CI redeploys — git stays the source of
 * truth, the panel is just a friendly pen.
 *
 * Deliberately a STATIC page (no session read here): the Free-plan CPU cap
 * 1102s intermittent SSR, and a static shell costs ~0 CPU. All auth lives in
 * the API route, which fails closed — the form renders "Not authorized" from
 * its 403. The shell itself contains only public catalog facts. */
export default function AdminLabSettingsPage() {
  // Build-time catalog context for the form: current effective prices + defaults.
  const labs = LABS.map((l) => ({
    slug: l.slug,
    title: l.title,
    level: l.level,
    track: l.track,
    free: l.free,
    ready: l.ready,
    tags: l.tags,
    effectiveINR: l.free ? "Free" : formatMoney(priceFor(l.slug, "per-lab", "INR"), "INR"),
    effectiveUSD: l.free ? "Free" : formatMoney(priceFor(l.slug, "per-lab", "USD"), "USD"),
  }));

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">Admin</p>
      <h1 className="mt-1 text-2xl font-bold text-ink">Lab settings</h1>
      <p className="mt-1 max-w-2xl text-base text-ink-soft">
        Per-lab price overrides, keywords, and flags. Saving commits to <span className="font-semibold text-ink">both repos</span> and
        CI redeploys — changes are live in ~5–10 minutes, with full git history behind every edit.
      </p>
      <div className="mt-6">
        <LabSettingsForm labs={labs} />
      </div>
      <p className="mt-6 text-xs leading-relaxed text-muted">
        Empty price = flat pricing (₹249 / $4 per paid lab). Keywords replace the lab&apos;s tags on the labs app and the
        marketing site. <span className="font-semibold">Live</span> controls whether the lab is launchable;{" "}
        <span className="font-semibold">Free</span> marks it as the free tier. Lab content itself (guide, template, grading)
        stays in git — see the repo&apos;s add-a-lab flow.
      </p>
    </div>
  );
}
