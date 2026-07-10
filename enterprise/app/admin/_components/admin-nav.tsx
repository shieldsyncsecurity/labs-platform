"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/brand";

// Shared top nav for every signed-in admin page. Mirrors
// app/portal/_components/portal-nav.tsx but is its own component -- admin
// and portal nav must never share state or a sign-out endpoint (see
// lib/server/admin-session.ts for why the two sessions are separate).
export default function AdminNav() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Logo href="/admin" size={24} />
          <Link
            href="/admin"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Organizations
          </Link>
          <Link
            href="/admin/orgs/new"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            New org
          </Link>
          <Link
            href="/admin/leads"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Leads
          </Link>
          <Link
            href="/admin/agreements"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Agreements
          </Link>
          <Link
            href="/admin/forensics"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Forensics
          </Link>
          <Link
            href="/admin/erase"
            className="rounded text-sm text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Data requests
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline text-xs text-muted">ShieldSync staff only</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded text-sm font-medium text-ink-soft hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
