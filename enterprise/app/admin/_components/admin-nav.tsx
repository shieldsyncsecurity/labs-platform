"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

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
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-sm font-bold text-ink">
            ShieldSync Admin
          </Link>
          <Link href="/admin" className="text-sm text-ink-soft hover:text-brand-strong">
            Organizations
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted">ShieldSync staff only</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm font-medium text-ink-soft hover:text-brand-strong"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
