import Link from "next/link";
import { Logo } from "@/components/brand";

const CONTACT_MAILTO =
  "mailto:info@shieldsyncsecurity.com?subject=" +
  encodeURIComponent("ShieldSync Enterprise");

/** Shared footer for the enterprise marketing/report surfaces. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Logo href="/" />
            <p className="mt-3 text-sm text-muted">
              Empowering Cybersecurity Futures. Hire cloud security talent on proof, not resumes.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            <a href="https://shieldsyncsecurity.com" className="font-medium text-ink-soft hover:text-ink">
              Main site
            </a>
            <Link href="/demo/report" className="font-medium text-ink-soft hover:text-ink">
              Sample report
            </Link>
            <a href={CONTACT_MAILTO} className="font-medium text-ink-soft hover:text-ink">
              Contact
            </a>
          </nav>
        </div>
        <div className="flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted">
            &copy; {new Date().getFullYear()} ShieldSync Security Private Limited. All rights reserved.
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
            <Link href="/privacy" className="font-medium text-muted hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="font-medium text-muted hover:text-ink">
              Terms
            </Link>
            <a href="/.well-known/security.txt" className="font-medium text-muted hover:text-ink">
              Security
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
