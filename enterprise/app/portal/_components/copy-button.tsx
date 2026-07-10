"use client";

import { useState } from "react";

// Small "Copy" button for the two links employers actually need out of this
// portal: the org-wide report link and per-candidate invite links. Kept as
// its own tiny client component (per the build brief) so every server
// component around it can stay a server component.
export default function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("no clipboard API");
      }
    } catch {
      // Fallback for browsers/contexts without navigator.clipboard (e.g. non-HTTPS).
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        // Give up silently -- the value is still visible on screen to copy by hand.
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    // aria-live so the "Copied" swap is announced -- a screen-reader user
    // otherwise gets no feedback that the click did anything.
    <button
      type="button"
      onClick={handleCopy}
      aria-live="polite"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
