"use client";

import { useEffect, useState } from "react";

/**
 * Mobile-only note: the hands-on AWS console really wants a bigger screen (you can
 * still read the guide on a phone). Persists its dismissal so it doesn't nag.
 *
 * (The old first-run "Here's how a lab works" cue was removed — it duplicated the
 * always-visible highlights strip on the lab page; the page's own UI — guide, Launch
 * panel, Check my work — makes the flow self-evident.)
 */
export function LabIntro() {
  const [showMobile, setShowMobile] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem("ss-lab-mobile-note-dismissed")) setShowMobile(true);
    } catch {}
  }, []);

  const dismissMobile = () => {
    setShowMobile(false);
    try { localStorage.setItem("ss-lab-mobile-note-dismissed", "1"); } catch {}
  };

  if (!showMobile) return null;

  return (
    <div className="mt-4 lg:hidden">
      <div className="flex items-start gap-2.5 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3 text-sm text-[#92400e]">
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
    </div>
  );
}
