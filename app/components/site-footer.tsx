"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { shellMaxWidth } from "@/lib/shell";

export function SiteFooter() {
  const shell = shellMaxWidth(usePathname());
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`mx-auto flex ${shell} flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10`}>
        <span>ShieldSync Labs · hands-on cloud security · each lab runs in its own isolated, auto-destroyed AWS account.</span>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 font-semibold text-ink-soft">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink">
            Terms
          </Link>
          <a href="/.well-known/security.txt" className="hover:text-ink">
            Security
          </a>
          <a href="https://shieldsyncsecurity.com" className="whitespace-nowrap hover:text-ink">
            ← Back to ShieldSync.com
          </a>
        </nav>
      </div>
    </footer>
  );
}
