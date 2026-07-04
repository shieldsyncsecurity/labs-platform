"use client";

import { usePathname } from "next/navigation";
import { shellMaxWidth } from "@/lib/shell";

export function SiteFooter() {
  const shell = shellMaxWidth(usePathname());
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`mx-auto flex ${shell} flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10`}>
        <span>ShieldSync Labs · hands-on cloud security · each lab runs in its own isolated, auto-destroyed AWS account.</span>
        <a href="https://shieldsyncsecurity.com" className="whitespace-nowrap font-semibold text-ink-soft hover:text-ink">
          ← Back to ShieldSync.com
        </a>
      </div>
    </footer>
  );
}
