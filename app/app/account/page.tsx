"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { getLab } from "@/lib/labs";

export default function AccountPage() {
  const { user, loading, entitlements, signOut } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse px-5 py-10">
        <div className="h-7 w-40 rounded bg-line/60" />
        <div className="mt-6 h-40 rounded-2xl bg-line/30" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-5 py-8 text-center sm:py-10">
        <h1 className="text-2xl font-bold text-ink">You&apos;re signed out</h1>
        <p className="mt-2 text-base text-ink-soft">Sign in to see your entitlements and download your certificates.</p>
        <Link href="/sign-in" className="mt-6 inline-block rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold text-ink">Account</h1>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
        <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-base">
          <dt className="text-muted">Name</dt>
          <dd className="font-semibold text-ink">{user.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="text-ink">{user.email}</dd>
          <dt className="text-muted">Signed in via</dt>
          <dd className="capitalize text-ink">{user.provider}</dd>
        </dl>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-extrabold text-ink">Entitlements</h2>
      {entitlements.length === 0 ? (
        <p className="text-base text-ink-soft">No purchases yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {entitlements.map((e) => (
            <li key={e.labSlug} className="flex items-center justify-between px-5 py-3 text-base">
              <span className="text-ink">{e.labSlug === "*" ? "All AWS labs" : (getLab(e.labSlug)?.title ?? e.labSlug)}</span>
              <span className="text-sm text-muted">
                {e.kind}
                {e.accessUntil ? ` · until ${new Date(e.accessUntil).toLocaleDateString()}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => signOut()}
        className="mt-8 rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas"
      >
        Sign out
      </button>
    </div>
  );
}
