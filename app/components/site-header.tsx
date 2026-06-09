"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2 font-extrabold text-ink">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm text-white">S</span>
          <span>
            Shield<span className="text-brand">Sync</span>{" "}
            <span className="font-semibold text-muted">Labs</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-[15px] font-semibold text-ink-soft">
          <Link href="/" className="rounded-lg px-3 py-2 hover:bg-canvas">
            Catalog
          </Link>
          <Link href="/dashboard" className="rounded-lg px-3 py-2 hover:bg-canvas">
            Dashboard
          </Link>

          {loading ? null : user ? (
            <div className="ml-2 flex items-center gap-3">
              <Link href="/account" className="hidden text-muted hover:text-ink sm:inline">
                {user.name}
              </Link>
              <button
                onClick={() => signOut()}
                className="rounded-lg border border-line px-3 py-2 hover:bg-canvas"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/sign-in"
              className="ml-2 rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-strong"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
