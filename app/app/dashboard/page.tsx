"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { LABS, type Lab } from "@/lib/labs";

function LabCard({ lab, owned }: { lab: Lab; owned: boolean }) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 transition hover:border-line-strong hover:shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold badge-${lab.level.toLowerCase()}`}>
          {lab.level}
        </span>
        {lab.free ? (
          <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">FREE</span>
        ) : !owned ? (
          <span className="rounded-md border border-line px-2 py-0.5 text-xs font-bold text-muted">🔒 Locked</span>
        ) : null}
        <span className="ml-auto text-xs text-muted">~{lab.estimatedActiveMinutes} min</span>
      </div>
      <h3 className="text-lg font-extrabold text-ink">{lab.title}</h3>
      <p className="mt-1 flex-1 text-sm text-ink-soft">{lab.summary}</p>
      <Link
        href={`/labs/${lab.slug}`}
        className={
          owned
            ? "mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white hover:bg-brand-strong"
            : "mt-4 inline-block rounded-lg border border-line px-4 py-2 text-[15px] font-semibold text-ink hover:bg-canvas"
        }
      >
        {owned ? "Open lab →" : "Get access →"}
      </Link>
    </div>
  );
}

export default function DashboardPage() {
  const { user, loading, hasAccess } = useAuth();

  if (loading) {
    return <div className="mx-auto max-w-[1800px] px-4 py-16 text-muted sm:px-6 lg:px-10">Loading…</div>;
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

  const ready = LABS.filter((l) => l.ready);
  const yours = ready.filter((l) => hasAccess(l.slug));
  const more = ready.filter((l) => !hasAccess(l.slug));

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-10 sm:px-6 lg:px-10">
      <h1 className="text-2xl font-extrabold text-ink">Welcome back, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-base text-ink-soft">Pick a lab and spin up your own isolated AWS account in a couple of minutes.</p>

      <h2 className="mb-3 mt-8 text-lg font-extrabold text-ink">Your labs</h2>
      {yours.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-base text-ink-soft">
          Nothing unlocked yet.{" "}
          <Link href="/" className="font-semibold text-brand hover:underline">
            Browse the catalog
          </Link>{" "}
          — the first beginner lab is free.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {yours.map((lab) => (
            <LabCard key={lab.slug} lab={lab} owned />
          ))}
        </div>
      )}

      {more.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-lg font-extrabold text-ink">More to unlock</h2>
          <p className="mb-3 text-sm text-ink-soft">One-time purchase per lab — hands-on, auto-graded, fully isolated.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {more.map((lab) => (
              <LabCard key={lab.slug} lab={lab} owned={false} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
