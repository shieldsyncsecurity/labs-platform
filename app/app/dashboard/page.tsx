"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { LABS, type Lab } from "@/lib/labs";
import type { Completion } from "@/lib/server/store";
import { CertificateButton } from "@/components/certificate-button";

// Compact card — level + free/locked + ~min on one row, 2-line-clamped summary,
// one CTA. Denser than the old card so more fit per viewport without scrolling.
function LabCard({ lab, owned, completed }: { lab: Lab; owned: boolean; completed: boolean }) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold badge-${lab.level.toLowerCase()}`}>
          {lab.level}
        </span>
        {lab.free ? (
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] font-bold text-brand">FREE</span>
        ) : !owned ? (
          <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-bold text-muted"><span aria-hidden>🔒</span> Locked</span>
        ) : null}
        {completed && (
          <span className="rounded-md bg-green-600/10 px-1.5 py-0.5 text-[11px] font-bold text-green-700">
            <span aria-hidden>✓</span> Completed
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted">~{lab.estimatedActiveMinutes} min</span>
      </div>
      <h3 className="mt-1.5 text-base font-extrabold text-ink">{lab.title}</h3>
      <p className="mt-1 line-clamp-2 flex-1 text-sm text-ink-soft">{lab.summary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/labs/${lab.slug}`}
          className={
            owned
              ? "inline-block rounded-lg bg-brand px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong"
              : "inline-block rounded-lg border border-line px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-canvas"
          }
        >
          {owned ? "Open lab →" : "Get access →"}
        </Link>
        {/* Durable re-download: works even after the lab account is wiped —
            the certificate is derived from the permanent completion row, not
            the (torn-down) lab session. */}
        {completed && (
          <CertificateButton
            labSlug={lab.slug}
            label="Certificate"
            className="inline-block rounded-lg border border-line px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-canvas"
          />
        )}
      </div>
    </div>
  );
}

// The single actionable "what do I do next?" card. Deterministic pick: the free
// lab if the learner hasn't got a paid one yet, else the first lab they have
// access to. Labeled "Recommended" — we have no in-progress/completion state to
// justify "Continue".
function HeroLab({ lab }: { lab: Lab }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="h-[3px] w-full bg-gradient-to-r from-brand to-cyan" aria-hidden />
      <div className="bg-gradient-to-r from-brand/[0.08] to-cyan/[0.04] p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-brand">Recommended</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-xs font-bold badge-${lab.level.toLowerCase()}`}>
            {lab.level}
          </span>
          {lab.free && (
            <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">FREE</span>
          )}
          <span className="text-xs text-muted">~{lab.estimatedActiveMinutes} min</span>
        </div>
        <h2 className="mt-2 text-xl font-extrabold text-ink sm:text-2xl">{lab.title}</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-soft">{lab.summary}</p>
        <Link
          href={`/labs/${lab.slug}`}
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-cyan px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/20 transition hover:brightness-110"
        >
          Start lab →
        </Link>
      </div>
    </div>
  );
}

type Filter = "all" | "yours" | "locked";

function FilterChips({
  filter,
  onPick,
  counts,
}: {
  filter: Filter;
  onPick: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const opts: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "yours", label: "Yours" },
    { key: "locked", label: "Locked" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter labs">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={filter === o.key}
          onClick={() => onPick(o.key)}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
            filter === o.key
              ? "bg-brand text-white shadow-sm"
              : "border border-line text-ink-soft hover:bg-canvas"
          }`}
        >
          {o.label} <span className="opacity-70">({counts[o.key]})</span>
        </button>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading, hasAccess } = useAuth();
  const [filter, setFilter] = useState<Filter>("all");

  if (loading) {
    return <div className="mx-auto max-w-[1536px] px-4 py-16 text-muted sm:px-6 lg:px-10">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <h1 className="text-2xl font-extrabold text-ink">Sign in to see your labs</h1>
        <p className="mt-2 text-base text-ink-soft">Your dashboard shows the labs you can launch and your access windows.</p>
        <Link href="/sign-in" className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
          Sign in
        </Link>
      </div>
    );
  }

  return <SignedInDashboard firstName={user.name.split(" ")[0]} hasAccess={hasAccess} filter={filter} setFilter={setFilter} />;
}

function SignedInDashboard({
  firstName,
  hasAccess,
  filter,
  setFilter,
}: {
  firstName: string;
  hasAccess: (slug: string) => boolean;
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  const ready = useMemo(() => LABS.filter((l) => l.ready), []);
  const yours = useMemo(() => ready.filter((l) => hasAccess(l.slug)), [ready, hasAccess]);
  const launchableCount = yours.length;

  // F2: server-side completion tracking — fetched client-side so the rest of the
  // page (which reads from local LABS + entitlements) doesn't wait on it. Don't
  // fake a count before this resolves; the stat strip below only adds the
  // "X complete" segment once `completedSlugs` is non-null.
  const [completedSlugs, setCompletedSlugs] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/completions");
        if (!r.ok) return;
        const data = (await r.json()) as { completions?: Completion[] };
        if (!cancelled) setCompletedSlugs(new Set((data.completions ?? []).map((c) => c.labSlug)));
      } catch {
        /* offline / not ready — leave as null, stat strip omits the count */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const completedCount = useMemo(
    () => (completedSlugs ? ready.filter((l) => completedSlugs.has(l.slug)).length : 0),
    [ready, completedSlugs]
  );

  // Deterministic hero pick: the free lab if the learner doesn't already have a
  // paid one, else the first lab they have access to, else the first ready lab.
  const heroLab = useMemo(() => {
    const ownedPaid = yours.find((l) => !l.free);
    if (!ownedPaid) {
      const free = ready.find((l) => l.free);
      if (free) return free;
    }
    return yours[0] ?? ready[0] ?? null;
  }, [ready, yours]);

  // Grid excludes the hero to avoid duplication.
  const gridLabs = useMemo(() => ready.filter((l) => l.slug !== heroLab?.slug), [ready, heroLab]);
  const locked = useMemo(() => gridLabs.filter((l) => !hasAccess(l.slug) && !l.free), [gridLabs, hasAccess]);
  const gridYours = useMemo(() => gridLabs.filter((l) => hasAccess(l.slug)), [gridLabs, hasAccess]);

  const counts: Record<Filter, number> = {
    all: gridLabs.length,
    yours: gridYours.length,
    locked: locked.length,
  };

  const filtered = filter === "yours" ? gridYours : filter === "locked" ? locked : gridLabs;

  return (
    <div className="mx-auto max-w-[1536px] px-4 py-8 sm:px-6 lg:px-10">
      {/* Slim header row */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-extrabold text-ink">Welcome back, {firstName}</h1>
        <p className="text-sm text-ink-soft">
          {ready.length} lab{ready.length === 1 ? "" : "s"} · {launchableCount} you can launch now
          {completedSlugs && <> · {completedCount} of {ready.length} complete</>} · first lab free
        </p>
      </div>

      {/* Hero: recommended next action */}
      {heroLab && (
        <div className="mt-5">
          <HeroLab lab={heroLab} />
        </div>
      )}

      {/* Unified filterable grid */}
      {gridLabs.length > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-extrabold text-ink">All labs</h2>
            <FilterChips filter={filter} onPick={setFilter} counts={counts} />
          </div>

          {filtered.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line bg-surface p-6 text-base text-ink-soft">
              {filter === "yours" ? "Nothing unlocked here yet." : "Nothing locked here — you have access to everything."}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((lab) => (
                <LabCard
                  key={lab.slug}
                  lab={lab}
                  owned={hasAccess(lab.slug)}
                  completed={completedSlugs?.has(lab.slug) ?? false}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
