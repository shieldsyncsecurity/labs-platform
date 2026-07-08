import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

// Root 404. Reached for unknown routes and for notFound() calls that aren't
// caught by a closer not-found boundary. Deliberately vague about assessment /
// report links (they are secret-token URLs) -- don't imply what should exist.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-1px)] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">404</p>
      <h1 className="mt-3 text-2xl font-bold text-ink">Page not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved. If you followed an
        assessment or report link, it may have expired &mdash; check with whoever shared it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong"
      >
        Back to home
      </Link>
    </div>
  );
}
