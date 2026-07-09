"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// Shared top nav for every signed-in portal page. Sign-out just clears the
// session cookie server-side and bounces to /portal/login.
export default function PortalNav({ orgId }: { orgId: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-6">
          <Link href="/portal" className="text-sm font-bold text-ink">
            ShieldSync Enterprise
          </Link>
          <Link href="/portal" className="text-sm text-ink-soft hover:text-brand-strong">
            Dashboard
          </Link>
          <Link href="/portal/billing" className="text-sm text-ink-soft hover:text-brand-strong">
            Billing
          </Link>
          <Link href="/portal/agreements" className="text-sm text-ink-soft hover:text-brand-strong">
            Agreements
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-muted">{orgId}</span>
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
