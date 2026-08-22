"use client";

import { useEffect, useState } from "react";

/**
 * Thin fixed bar at the very top of the viewport that fills left-to-right as the
 * page scrolls, giving a lightweight read-progress cue. Uses the app's brand
 * gradient, pinned above the header. Purely decorative (aria-hidden); the CSS
 * transition is disabled under prefers-reduced-motion in globals.css.
 */
export function ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      const el = document.documentElement;
      const scrolled = el.scrollTop || document.body.scrollTop;
      const height = el.scrollHeight - el.clientHeight;
      setPct(height > 0 ? (scrolled / height) * 100 : 0);
      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="scroll-progress"
      style={{ width: `${pct}%` }}
    />
  );
}
