"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/brand";

// Shared top nav for every signed-in portal page. Client component: it owns the
// sign-out action and highlights the active route.
//
// It deliberately does NOT render the orgId. orgId is a bearer-secret-shaped
// value (see billing/page.tsx) and has no place in the persistent chrome where
// it would sit on every screen / screenshot. The prop is still accepted so the
// existing callers compile unchanged.
const LINKS = [
  { href: "/portal", label: "Dashboard" },
  { href: "/portal/billing", label: "Billing" },
  { href: "/portal/agreements", label: "Agreements" },
];

const SUPPORT_MAILTO =
  "mailto:hello@shieldsyncsecurity.com?subject=" +
  encodeURIComponent("ShieldSync Enterprise - support");

export default function PortalNav(_props: { orgId?: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleSignOut() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  // Dashboard owns /portal and the assessment pages; the others match their
  // own subtree.
  function isActive(href: string) {
    if (href === "/portal") {
      return pathname === "/portal" || pathname.startsWith("/portal/assessments");
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  const linkCls = (active: boolean) =>
    `rounded text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
      active ? "font-semibold text-brand-strong" : "text-ink-soft hover:text-brand-strong"
    }`;

  return (
    <nav className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Logo href="/portal" size={24} />
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={linkCls(active)}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-4">
          <a href={SUPPORT_MAILTO} className={linkCls(false)}>
            Help
          </a>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded text-sm font-medium text-ink-soft transition-colors hover:text-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
