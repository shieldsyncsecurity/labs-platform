import Link from "next/link";
import { Logo } from "@/components/brand";

// Root-relative (/#how, not #how) so the nav still works from /privacy,
// /terms and any other page that renders this header.
const NAV = [
  { label: "How it works", href: "/#how" },
  { label: "Why it's real", href: "/#why-real" },
  { label: "The report", href: "/#report" },
];

/** Marketing header for the enterprise homepage: sticky, translucent, logo + anchor
 *  nav + primary CTA. Server component (anchor nav scrolls via CSS scroll-behavior;
 *  no JS). On mobile the anchor nav hides, leaving logo + CTA. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Logo href="/" />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-[15px] font-medium text-ink-soft transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://shieldsyncsecurity.com"
            className="hidden rounded-lg text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:inline"
          >
            shieldsyncsecurity.com
          </a>
          <Link
            href="/book-demo"
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Book a walkthrough
          </Link>
        </div>
      </div>
    </header>
  );
}
