"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function LabGuide({ slug, instructions }: { slug: string; instructions: string }) {
  const { user, hasAccess, loading } = useAuth();

  // Free labs and already-paid users get immediate access.
  // hasAccess() returns true for free labs without needing entitlements.
  if (hasAccess(slug)) {
    return (
      <article className="lab-md rounded-2xl border border-line bg-surface p-6 sm:p-7">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructions}</ReactMarkdown>
      </article>
    );
  }

  // Still fetching entitlements — show skeleton so a paid user doesn't see a flash of the lock
  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-7">
        <div className="space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-full animate-pulse rounded bg-canvas" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-canvas" />
        </div>
      </div>
    );
  }

  // Locked — blurred preview + overlay
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      {/* blurred teaser — aria-hidden so screen readers skip it */}
      <div
        className="pointer-events-none select-none p-6 sm:p-7"
        style={{ filter: "blur(5px)", opacity: 0.3 }}
        aria-hidden
      >
        <article className="lab-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructions.slice(0, 700)}</ReactMarkdown>
        </article>
      </div>

      {/* lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/75 p-8 text-center backdrop-blur-[2px]">
        <span className="text-3xl">🔒</span>
        <p className="mt-3 text-base font-extrabold text-ink">Guide locked</p>
        <p className="mt-1 max-w-xs text-sm text-ink-soft">
          Purchase this lab to unlock the full step-by-step guide and start your session.
        </p>
        {!user ? (
          <Link
            href="/sign-in"
            className="mt-5 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Sign in to get access
          </Link>
        ) : (
          <p className="mt-4 text-xs text-muted">Use the panel on the right to purchase.</p>
        )}
      </div>
    </div>
  );
}
