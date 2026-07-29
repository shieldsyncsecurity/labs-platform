"use client";

import { useAuth } from "@/lib/auth/context";
import { getLab } from "@/lib/labs";
import { EntitlementStatus } from "@/components/entitlement-status";
import { entitlementTypeOf } from "@/lib/auth/types";
import { SignedOutNotice } from "@/components/signed-out-notice";

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
      <SignedOutNotice
        heading="You're signed out"
        sub="Sign in to see your entitlements and download your certificates."
      />
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
            <li key={e.labSlug} className="px-5 py-3">
              <span className="text-base text-ink">{e.labSlug === "*" ? "All AWS labs" : (getLab(e.labSlug)?.title ?? e.labSlug)}</span>
              {/* Was rendering the raw kind string + accessUntil (the 90-day backstop) —
                  for a per-lab grant that read "until 23 Oct" when the real limit is 3
                  launches / 7 days from first launch, understating how soon access
                  actually ends. Reuse the same status logic the lab page already shows,
                  instead of a second, incorrect summary of the same entitlement. */}
              <EntitlementStatus entitlement={e} labSlug={e.labSlug !== "*" ? e.labSlug : undefined} />
              {/* EntitlementStatus deliberately renders nothing for LIFETIME (no launch
                  cap to report on the lab page) — but a bare row with no status text at
                  all reads as unfinished here, so say plainly that it's uncapped. */}
              {entitlementTypeOf(e) === "LIFETIME" && (
                <p className="mt-3 text-sm text-ink-soft">Unlimited access — no launch cap.</p>
              )}
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
