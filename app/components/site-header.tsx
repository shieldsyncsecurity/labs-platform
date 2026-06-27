"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-extrabold text-ink">
          <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-brand text-sm text-white">S</span>
          <span className="whitespace-nowrap">
            Shield<span className="text-brand">Sync</span>
            <span className="hidden font-semibold text-muted sm:inline"> Labs</span>
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 text-sm font-semibold text-ink-soft sm:gap-1 sm:text-[15px]">
          {/* Back to the marketing site (cross-origin → plain anchor, same tab). */}
          <a
            href="https://shieldsyncsecurity.com"
            className="hidden rounded-lg px-3 py-2 text-muted hover:bg-canvas hover:text-ink sm:inline"
          >
            ← Main site
          </a>
          <Link href="/" className="rounded-lg px-2.5 py-2 hover:bg-canvas sm:px-3">
            Catalog
          </Link>
          <Link href="/dashboard" className="rounded-lg px-2.5 py-2 hover:bg-canvas sm:px-3">
            Dashboard
          </Link>

          {loading ? null : user ? (
            <div className="ml-1 flex items-center gap-2 sm:ml-2 sm:gap-3">
              <Link href="/account" className="hidden text-muted hover:text-ink sm:inline">
                {user.name}
              </Link>
              <button
                onClick={() => signOut()}
                className="rounded-lg border border-line px-2.5 py-2 hover:bg-canvas sm:px-3"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="ml-1 rounded-lg bg-brand px-3 py-2 text-white hover:bg-brand-strong sm:ml-2 sm:px-4"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
