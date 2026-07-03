"use client";

import { useEffect, useState } from "react";

/**
 * One compact, dismissible orientation cue shown above the lab workspace.
 * Explains the page layout so a first-time learner isn't hunting for the
 * launch button. On mobile viewports, a short "best on a laptop" note is
 * appended inline to the same banner instead of stacking a second one.
 * Persists dismissal in localStorage so it doesn't nag; the mobile-note key
 * is preserved (unused for its own banner now) so nothing new needs migrating.
 */
export function LabIntro() {
  const [show, setShow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("ss-lab-intro-seen")) setShow(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)"); // matches Tailwind's lg breakpoint
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem("ss-lab-intro-seen", "1");
      localStorage.setItem("ss-lab-mobile-note-dismissed", "1");
    } catch {}
  };

  if (!show) return null;

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5 text-sm text-ink-soft">
      <span aria-hidden className="flex-none text-sm leading-none">👋</span>
      <p className="flex-1 leading-snug">
        <strong className="text-ink">New here?</strong> Follow the guide, hit <strong>Launch</strong> on the
        right, then <strong>Check my work</strong> — the account wipes itself.
        {isMobile && (
          <>
            {" "}
            <strong>Best on a laptop or desktop</strong> — the hands-on console steps work best on a bigger screen.
          </>
        )}
      </p>
      <button
        onClick={dismiss}
        aria-label="Got it"
        className="flex-none rounded-md px-1.5 text-muted hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
