"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { LABS } from "@/lib/labs";

export default function DashboardPage() {
  const { user, loading, hasAccess } = useAuth();

  if (loading) {
    return <div className="mx-auto max-w-6xl px-5 py-16 text-muted">Loading…</div>;
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

  const accessible = LABS.filter((l) => l.ready && hasAccess(l.slug));

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <h1 className="text-2xl font-extrabold text-ink">Welcome back, {user.name.split(" ")[0]}</h1>
      <p className="mt-1 text-base text-ink-soft">Labs you can launch right now.</p>

      <h2 className="mb-3 mt-8 text-lg font-extrabold text-ink">Your labs</h2>
      {accessible.length === 0 ? (
        <p className="text-base text-ink-soft">
          Nothing yet.{" "}
          <Link href="/" className="font-semibold text-brand hover:underline">
            Browse the catalog
          </Link>{" "}
          — the first beginner lab is free.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accessible.map((lab) => (
            <div key={lab.slug} className="rounded-2xl border border-line bg-surface p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold badge-${lab.level.toLowerCase()}`}>
                  {lab.level}
                </span>
                {lab.free && <span className="rounded-md bg-brand/10 px-2 py-0.5 text-xs font-bold text-brand">FREE</span>}
              </div>
              <h3 className="text-lg font-extrabold text-ink">{lab.title}</h3>
              <Link
                href={`/labs/${lab.slug}`}
                className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-[15px] font-semibold text-white hover:bg-brand-strong"
              >
                Open lab
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
