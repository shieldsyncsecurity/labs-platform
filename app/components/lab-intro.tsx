"use client";

import { useEffect, useState } from "react";

/**
 * Two lightweight, dismissible cues shown above the lab workspace:
 *  • a mobile-only note that the hands-on AWS console really wants a bigger
 *    screen (you can still read the guide on a phone);
 *  • a first-run orientation cue (shown once, any device) that explains the
 *    page layout so a first-time learner isn't hunting for the launch button.
 * Both persist their dismissal in localStorage so they don't nag.
 */
export function LabIntro() {
  const [showIntro, setShowIntro] = useState(false);
  const [showMobile, setShowMobile] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("ss-lab-intro-seen")) setShowIntro(true);
      if (!localStorage.getItem("ss-lab-mobile-note-dismissed")) setShowMobile(true);
    } catch {}
  }, []);

  const dismissIntro = () => {
    setShowIntro(false);
    try { localStorage.setItem("ss-lab-intro-seen", "1"); } catch {}
  };
  const dismissMobile = () => {
    setShowMobile(false);
    try { localStorage.setItem("ss-lab-mobile-note-dismissed", "1"); } catch {}
  };

  if (!showIntro && !showMobile) return null;

  return (
    <div className="mt-4 space-y-3">
      {/* Mobile-only: the AWS console hands-on steps need a real screen */}
      {showMobile && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3 text-sm text-[#92400e] lg:hidden">
          <span aria-hidden className="text-base leading-none">🖥️</span>
          <div className="flex-1">
            <p className="font-semibold">Best on a laptop or desktop</p>
            <p className="mt-0.5">
              You can read the full guide here, but the hands-on AWS console steps work best on a
              bigger screen. Switch to a computer when you&apos;re ready to launch.
            </p>
          </div>
          <button
            onClick={dismissMobile}
            aria-label="Dismiss"
            className="flex-none rounded-md px-1.5 text-[#92400e]/70 hover:text-[#92400e]"
          >
            ✕
          </button>
        </div>
      )}

      {/* First-run: orient the layout (once, any device) */}
      {showIntro && (
        <div className="flex items-start gap-2.5 rounded-xl border border-brand/30 bg-brand/5 p-3.5 text-sm text-ink-soft">
          <span aria-hidden className="text-base leading-none">👋</span>
          <div className="flex-1">
            <p className="font-semibold text-ink">New here? Here&apos;s how a lab works</p>
            <p className="mt-0.5">
              Follow the <strong>step-by-step guide</strong>, then use the <strong>Launch</strong> panel
              to spin up your own isolated AWS account with a countdown. Open the console, work through
              the steps, and hit <strong>Check my work</strong> to grade yourself. When you&apos;re done
              the account is wiped automatically.
            </p>
          </div>
          <button
            onClick={dismissIntro}
            aria-label="Got it"
            className="flex-none rounded-md px-1.5 text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
