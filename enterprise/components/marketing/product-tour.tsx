"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldMark } from "@/components/brand";

/* ============================================================================
 * ShieldSync Enterprise - PRODUCT TOUR
 * A browser-window "player" that auto-plays through the 5-stage hiring
 * assessment flow. Pure React + Tailwind + inline SVG + CSS keyframes.
 *
 * State model
 * -----------
 *  - `active` (0..4): the scene currently shown.
 *  - `paused` (bool): whether auto-advance is running.
 *  - `cycle` (number): a monotonically increasing key bumped on EVERY scene
 *    entry (auto or manual). It is applied as React `key` on the active scene
 *    and the progress bar so their CSS animations RESTART from 0 on each entry,
 *    and so intra-scene animations replay when you revisit a tab.
 *
 * A single useEffect owns the auto-advance timer. It runs only when not
 * paused; it schedules one setTimeout for SCENE_MS, then advances (looping
 * 4 -> 0). Changing `active`, `paused`, or `cycle` re-arms the timer.
 * Clicking a tab sets `active`, bumps `cycle`, and pauses. Play/Pause toggles
 * `paused`; pressing Play from a paused state also bumps `cycle` so the
 * current scene restarts cleanly.
 *
 * Reduced motion: prefers-reduced-motion STARTS the tour paused instead of
 * disabling the timer outright — an explicit Play click is user opt-in, so
 * play must always work. (The old build gated the timer on `reduced`, which
 * left the Play button visibly toggling but doing nothing on machines with
 * animations off — e.g. Windows "Animation effects" disabled.)
 * ========================================================================== */

// Owner-tuned 2026-07-11: 4800ms/scene read as painfully slow when watched
// end-to-end (5 scenes = 24s). 3500ms keeps every beat readable at ~17.5s.
const SCENE_MS = 3500;

const SCENES = [
  {
    tab: "Invite",
    title: "Invite a candidate",
    caption: "You invite a candidate. One magic link - zero setup for them.",
    host: "enterprise.shieldsyncsecurity.com",
  },
  {
    tab: "Verify",
    title: "Verify by email",
    caption: "They verify by email - no account, no password to create.",
    host: "enterprise.shieldsyncsecurity.com",
  },
  {
    tab: "Solve",
    title: "Solve in a real AWS account",
    caption:
      "They work in a real, isolated AWS account - the actual console, not a quiz.",
    host: "console.aws.amazon.com",
  },
  {
    tab: "Grade",
    title: "Auto-graded on live cloud state",
    caption: "ShieldSync auto-grades the real cloud state - live, not multiple choice.",
    host: "enterprise.shieldsyncsecurity.com",
  },
  {
    tab: "Report",
    title: "Verified, side-by-side report",
    caption: "You get a verified, side-by-side report. Decide in minutes.",
    host: "enterprise.shieldsyncsecurity.com",
  },
] as const;

export function ProductTour() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  // Resolved once on mount; drives whether the timer ever runs.
  const [reduced, setReduced] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    // Respect the OS setting as the DEFAULT (start paused), not as a hard
    // disable — the Play button below is the user's explicit opt-in.
    if (mq.matches) setPaused(true);
    const onChange = (e: MediaQueryListEvent) => {
      setReduced(e.matches);
      if (e.matches) setPaused(true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Auto-advance timer. One timeout per scene entry.
  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => {
      setActive((a) => (a + 1) % SCENES.length);
      setCycle((c) => c + 1);
    }, SCENE_MS);
    return () => window.clearTimeout(id);
  }, [active, paused, cycle]);

  const jumpTo = useCallback((i: number) => {
    setActive(i);
    setCycle((c) => c + 1);
    setPaused(true);
  }, []);

  const togglePlay = useCallback(() => {
    setPaused((p) => {
      // Resuming: restart the current scene cleanly.
      if (p) setCycle((c) => c + 1);
      return !p;
    });
  }, []);

  const scene = SCENES[active];
  // Intra-scene animations run whenever motion is allowed OR the user pressed
  // Play themselves (explicit opt-in overrides prefers-reduced-motion).
  const animate = !reduced || !paused;

  return (
    // pt-root/pt-playing: globals.css scopes its reduced-motion kill-switch to
    // .pt-root:not(.pt-playing) so an explicit Play always animates.
    <div className={`pt-root mx-auto w-full max-w-4xl ${paused ? "" : "pt-playing"}`}>
      {/* --------------------------------------------------- CONTROL ROW */}
      {/* Above the player (owner call 2026-07-11): the stage tabs + play
          control are the affordance — they must be seen before the frame,
          not discovered under it. */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? "Play tour" : "Pause tour"}
          className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {paused ? (
            <svg viewBox="0 0 16 16" className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden="true">
              <path d="M4 3l9 5-9 5V3z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <rect x="4" y="3" width="3" height="10" rx="1" />
              <rect x="9" y="3" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>

        {/* scene tabs (real buttons, roving via aria-selected) */}
        <div
          role="tablist"
          aria-label="Assessment stages"
          className="flex flex-1 flex-wrap gap-1.5"
        >
          {SCENES.map((s, i) => {
            const isActive = i === active;
            return (
              <button
                key={s.tab}
                id={`pt-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="pt-panel"
                aria-label={`Stage ${i + 1}: ${s.tab}`}
                onClick={() => jumpTo(i)}
                className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  isActive
                    ? "border-brand bg-brand/10 text-brand-strong"
                    : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink-soft"
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[10px] ${
                    isActive ? "bg-brand text-white" : "bg-canvas text-muted"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="text-[11px]">{s.tab}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* progress bar (amber fill), reset per scene entry */}
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div
          key={cycle}
          className={
            !paused ? "pt-progress h-full rounded-full bg-brand" : "h-full rounded-full bg-brand/40"
          }
          style={{ animationDuration: `${SCENE_MS}ms` }}
        />
      </div>

      {/* ---------------------------------------------------- PLAYER FRAME */}
      <div
        className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)]"
        role="group"
        aria-label="ShieldSync product tour player"
      >
        {/* browser chrome top bar */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1">
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3 flex-none text-muted"
                fill="none"
                aria-hidden="true"
              >
                <rect x="3.5" y="7" width="9" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span className="truncate font-mono text-[11px] text-muted sm:text-xs">
                {scene.host}
              </span>
            </div>
          </div>
          <div className="w-[46px]" aria-hidden="true" />
        </div>

        {/* ------------------------------------------------ SCENE VIEWPORT */}
        <div
          id="pt-panel"
          role="tabpanel"
          aria-labelledby={`pt-tab-${active}`}
          className="relative aspect-[16/10] w-full overflow-hidden bg-canvas"
        >
          <div key={cycle} className="pt-scene absolute inset-0">
            {active === 0 && <SceneInvite animate={animate} />}
            {active === 1 && <SceneVerify animate={animate} />}
            {active === 2 && <SceneSolve animate={animate} />}
            {active === 3 && <SceneGrade animate={animate} />}
            {active === 4 && <SceneReport animate={animate} />}
          </div>
        </div>
      </div>

      {/* caption */}
      <div className="mt-4 text-center">
        <p className="text-sm font-semibold text-ink">{scene.title}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">
          {scene.caption}
        </p>
      </div>
    </div>
  );
}

/* ==========================================================================
 * SHARED SHIELDSYNC CHROME (scenes 1, 4, 5)
 * ======================================================================== */

function ShieldTopBar() {
  return (
    <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
      <span className="inline-flex items-center gap-2">
        <ShieldMark size={18} />
        <span className="text-[13px] font-extrabold tracking-tight text-ink">
          Shield<span className="text-brand">Sync</span>
        </span>
        <span className="rounded-full border border-brand/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-brand">
          Enterprise
        </span>
      </span>
      <span className="hidden items-center gap-2 sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-brand" />
        <span className="font-mono text-[10px] text-muted">Acme Corp</span>
      </span>
    </div>
  );
}

/* ==========================================================================
 * SCENE 1 - INVITE
 * ======================================================================== */

function SceneInvite({ animate }: { animate: boolean }) {
  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      <ShieldTopBar />
      <div className="flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
          New assessment
        </p>
        <h3 className="mt-1.5 text-[15px] font-semibold text-ink sm:text-base">
          Cloud Security Engineer - S3 &amp; IAM Hardening
        </h3>

        <div className="mt-4 rounded-xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Add candidate
          </p>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.3fr_auto] sm:items-center">
            <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
              <span className="block text-[9px] uppercase tracking-wide text-muted">Name</span>
              <span className="text-[13px] text-ink">Priya Sharma</span>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-2.5 py-2">
              <span className="block text-[9px] uppercase tracking-wide text-muted">Email</span>
              <span className="font-mono text-[12px] text-ink">priya@acmecorp.io</span>
            </div>
            <div className="relative">
              <div
                className={`flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-[12px] font-semibold text-white shadow-sm ${
                  animate ? "pt-btn-press" : ""
                }`}
              >
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
                  <path d="M2 8l12-5-4 12-3-4-5-3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                Send invite
              </div>
              {/* cursor glides in and "clicks" (the pt-btn-press above fires
                  on its arrival) — same device as scene 3's AWS cursor */}
              {animate && (
                <svg viewBox="0 0 16 16" className="pt-cursor-invite h-4 w-4" fill="#16191f" aria-hidden="true">
                  <path d="M1 1l5 13 2-5 5-2L1 1z" stroke="#fff" strokeWidth="0.8" />
                </svg>
              )}
            </div>
          </div>

          {/* magic-link chip appears after send */}
          <div className={`mt-3 ${animate ? "pt-fade-in-3" : ""}`}>
            <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-brand/30 bg-brand/5 px-2.5 py-1.5">
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none text-brand" fill="none" aria-hidden="true">
                <path
                  d="M6.5 9.5l3-3m-1.2-2l1-1a2.6 2.6 0 013.7 3.7l-1 1m-4 4l-1 1a2.6 2.6 0 01-3.7-3.7l1-1"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="truncate font-mono text-[11px] text-brand-strong">
                enterprise.shieldsyncsecurity.com/a/8f2e...c39a
              </span>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none text-muted" fill="none" aria-hidden="true">
                <rect x="5" y="5" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* success toast slides in */}
      <div className={`pointer-events-none absolute bottom-4 right-4 ${animate ? "pt-toast-in" : ""}`}>
        <div className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-white px-3 py-2 shadow-lg">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-[12px] font-medium text-ink">
            Invite sent <span className="text-muted">- 1 credit used</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * SCENE 2 - VERIFY
 * ======================================================================== */

const OTP = ["4", "1", "8", "9", "0", "2"];

function SceneVerify({ animate }: { animate: boolean }) {
  return (
    <div className="grid h-full w-full grid-cols-1 bg-canvas sm:grid-cols-2">
      {/* email client */}
      <div className="hidden flex-col border-r border-line bg-surface sm:flex">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="font-mono text-[10px] text-muted">Inbox</span>
        </div>
        <div className="flex-1 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand/10">
              <ShieldMark size={14} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-ink">ShieldSync</p>
              <p className="truncate font-mono text-[9px] text-muted">no-reply@shieldsyncsecurity.com</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] font-semibold text-ink">
            Your assessment verification code
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            Enter this code to start your ShieldSync assessment. It expires in 10 minutes.
          </p>
          <div className="mt-3 rounded-xl border border-brand/25 bg-brand/5 px-4 py-3 text-center">
            <span className="font-mono text-2xl font-bold tracking-[0.25em] text-brand-strong">
              418 902
            </span>
          </div>
        </div>
      </div>

      {/* candidate landing + OTP */}
      <div className="flex flex-col">
        <ShieldTopBar />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-4 text-center">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
            ShieldSync Assessment
          </p>
          <p className="mt-1.5 text-[12px] text-ink-soft">
            invited by <span className="font-semibold text-ink">Acme Corp</span>
          </p>
          <p className="mt-4 text-[12px] font-medium text-ink">Enter your verification code</p>
          <div className="mt-3 flex items-center gap-1.5">
            {OTP.map((d, i) => (
              <span
                key={i}
                style={animate ? { animationDelay: `${0.35 + i * 0.22}s` } : undefined}
                className={`inline-flex h-9 w-7 items-center justify-center rounded-lg border border-line bg-surface font-mono text-base font-bold text-ink sm:w-8 ${
                  animate ? "pt-otp" : ""
                }`}
              >
                <span className={animate ? "pt-otp-digit" : ""}>{d}</span>
              </span>
            ))}
          </div>
          <div className={`mt-4 ${animate ? "pt-verified" : ""}`}>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-[11px] font-semibold text-white">
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
                <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Verified
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * SCENE 3 - SOLVE (mock AWS console-style screen)
 * Real AWS palette, real service names, but NO AWS smile logo - a plain
 * lowercase "aws" wordmark stands in as the nav brand (trademark guard).
 * ======================================================================== */

function SceneSolve({ animate }: { animate: boolean }) {
  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: "#f2f3f3" }}>
      {/* top nav */}
      <div
        className="flex items-center gap-3 px-3 py-2 text-[11px]"
        style={{ backgroundColor: "#232f3e", color: "#d5dbdb" }}
      >
        <span className="font-bold lowercase" style={{ color: "#ff9900" }}>
          aws
        </span>
        <span
          className="hidden rounded px-1.5 py-0.5 text-[10px] sm:inline"
          style={{ backgroundColor: "#1b232e" }}
        >
          Services
        </span>
        <span className="ml-auto hidden font-mono text-[10px] sm:inline" style={{ color: "#d5dbdb" }}>
          acct 7042-1188-3390
        </span>
        <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: "#1b232e" }}>
          N. Virginia
        </span>
      </div>

      {/* body: left service nav + content */}
      <div className="flex min-h-0 flex-1">
        <div
          className="hidden w-40 flex-none flex-col gap-1 px-3 py-3 text-[11px] sm:flex"
          style={{ backgroundColor: "#1b232e", color: "#d5dbdb" }}
        >
          <span className="mb-1 text-[9px] font-semibold uppercase tracking-wide" style={{ color: "#8b96a5" }}>
            Amazon S3
          </span>
          <span className="rounded px-2 py-1" style={{ backgroundColor: "#232f3e", color: "#ff9900" }}>
            Buckets
          </span>
          <span className="px-2 py-1">Access Points</span>
          <span className="px-2 py-1">IAM</span>
          <span className="px-2 py-1">CloudTrail</span>
        </div>

        <div className="min-w-0 flex-1 overflow-hidden px-3 py-3 sm:px-4">
          {/* breadcrumb */}
          <p className="text-[11px]" style={{ color: "#539fe5" }}>
            Amazon S3 <span style={{ color: "#6b7684" }}>&gt;</span> Buckets
          </p>

          {/* bucket table */}
          <div className="mt-2 overflow-hidden rounded border bg-white" style={{ borderColor: "#d5dbdb" }}>
            <div
              className="grid grid-cols-[1.6fr_1fr_auto] items-center px-3 py-1.5 text-[10px] font-semibold"
              style={{ backgroundColor: "#fafafa", color: "#545b64", borderBottom: "1px solid #eaeded" }}
            >
              <span>Name</span>
              <span>Access</span>
              <span>Region</span>
            </div>
            <div className="grid grid-cols-[1.6fr_1fr_auto] items-center px-3 py-2 text-[11px]" style={{ color: "#16191f" }}>
              <span className="truncate font-mono">sslab-data-7f2a</span>
              <span>
                {/* pill flips Public (red) -> Private (green) */}
                <span className={`inline-flex items-center gap-1 ${animate ? "pt-pill-public" : ""}`}>
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true" style={{ color: "#d13212" }}>
                    <path d="M8 2l6 11H2L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "#fdf0ef", color: "#d13212" }}
                  >
                    Public
                  </span>
                </span>
                <span className={`inline-flex items-center gap-1 ${animate ? "pt-pill-private" : "hidden"}`}>
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true" style={{ color: "#1d8102" }}>
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ backgroundColor: "#eff6ec", color: "#1d8102" }}
                  >
                    Private
                  </span>
                </span>
              </span>
              <span style={{ color: "#545b64" }}>us-east-1</span>
            </div>
          </div>

          {/* block public access control + cursor */}
          <div className="relative mt-2 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded px-2.5 py-1 text-[10px] font-semibold text-white ${
                animate ? "pt-bpa-btn" : ""
              }`}
              style={{ backgroundColor: "#ec7211" }}
            >
              Block public access
            </span>
            {animate && (
              <svg viewBox="0 0 16 16" className="pt-cursor h-4 w-4" fill="#16191f" aria-hidden="true">
                <path d="M1 1l5 13 2-5 5-2L1 1z" stroke="#fff" strokeWidth="0.8" />
              </svg>
            )}
          </div>

          {/* IAM policy panel: s3:* -> scoped */}
          <div className="mt-2 overflow-hidden rounded border bg-white" style={{ borderColor: "#d5dbdb" }}>
            <div
              className="flex items-center justify-between px-3 py-1 text-[10px] font-semibold"
              style={{ backgroundColor: "#fafafa", color: "#545b64", borderBottom: "1px solid #eaeded" }}
            >
              <span>IAM policy - sslab-access</span>
              <span style={{ color: "#539fe5" }}>Edit</span>
            </div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-[10px] leading-relaxed" style={{ color: "#16191f" }}>
{`"Effect": "Allow",
`}
              <span className={animate ? "pt-json-before" : ""}>
                <span style={{ color: "#16191f" }}>{`"Action": `}</span>
                <span
                  className="rounded"
                  style={{ backgroundColor: "#fdf0ef", color: "#d13212" }}
                >{`"s3:*"`}</span>
              </span>
              <span className={animate ? "pt-json-after" : "hidden"}>
                <span style={{ color: "#16191f" }}>{`"Action": `}</span>
                <span
                  className="rounded"
                  style={{ backgroundColor: "#eff6ec", color: "#1d8102" }}
                >{`["s3:GetObject","s3:PutObject"]`}</span>
              </span>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * SCENE 4 - GRADE
 * ======================================================================== */

const OBJECTIVES = [
  "Block public access",
  "Enable default encryption (SSE-KMS)",
  "TLS-only bucket policy",
  "Least-privilege IAM policy",
];

function SceneGrade({ animate }: { animate: boolean }) {
  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      <ShieldTopBar />
      <div className="flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
              Assessment room
            </p>
            <h3 className="mt-1 text-[13px] font-semibold text-ink sm:text-sm">
              S3 &amp; IAM Hardening - sslab-data-7f2a
            </h3>
          </div>
          <div className="flex-none rounded-lg border border-line bg-surface px-2.5 py-1 text-center">
            <span className="block text-[8px] uppercase tracking-wide text-muted">Time left</span>
            <span className="font-mono text-sm font-bold text-ink">42:17</span>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-line bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Objectives
            </p>
            <span className={`inline-flex items-center gap-1.5 ${animate ? "pt-checking" : "hidden"}`}>
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-brand" />
              <span className="font-mono text-[10px] text-muted">Checking live AWS state...</span>
            </span>
            <span className={`font-mono text-[11px] font-semibold text-green-700 ${animate ? "pt-score" : ""}`}>
              4 / 4 objectives
            </span>
          </div>
          <ul className="mt-2.5 flex flex-col gap-2">
            {OBJECTIVES.map((o, i) => (
              <li key={o} className="flex items-center gap-2.5">
                <span
                  style={animate ? { animationDelay: `${0.5 + i * 0.45}s` } : undefined}
                  className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                    animate ? "pt-obj-check border-line bg-canvas" : "border-green-600 bg-green-600"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 text-white" fill="none" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="text-[12px] text-ink">{o}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
 * SCENE 5 - REPORT
 * ======================================================================== */

const REPORT = [
  { name: "Priya S.", pct: 100, rank: 1 },
  { name: "Ananya K.", pct: 83, rank: 2 },
  { name: "Rahul M.", pct: 67, rank: 3 },
  { name: "Vikram T.", pct: 33, rank: 4 },
];

function SceneReport({ animate }: { animate: boolean }) {
  return (
    <div className="flex h-full w-full flex-col bg-canvas">
      <ShieldTopBar />
      <div className="flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
              Assessment report
            </p>
            <h3 className="mt-1 text-[13px] font-semibold text-ink sm:text-sm">
              Cloud Security Engineer
            </h3>
          </div>
          <div className="flex gap-3 font-mono text-[10px] text-muted">
            <span>Completed <span className="font-semibold text-ink">4/6</span></span>
            <span>Avg <span className="font-semibold text-ink">71%</span></span>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {REPORT.map((r, i) => (
            <div
              key={r.name}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                r.rank === 1
                  ? "border-brand/40 bg-brand/5 shadow-[0_1px_2px_rgba(217,119,6,0.12)]"
                  : "border-line bg-surface"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                  r.rank === 1 ? "bg-brand text-white" : "bg-canvas text-muted"
                }`}
              >
                {r.rank}
              </span>
              <span className={`w-16 flex-none text-[12px] ${r.rank === 1 ? "font-semibold text-ink" : "text-ink-soft"}`}>
                {r.name}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className={`block h-full rounded-full ${r.rank === 1 ? "bg-brand" : "bg-brand/60"} ${
                    animate ? "pt-bar" : ""
                  }`}
                  style={
                    animate
                      ? ({ "--pt-w": `${r.pct}%`, animationDelay: `${0.2 + i * 0.15}s` } as React.CSSProperties)
                      : { width: `${r.pct}%` }
                  }
                />
              </span>
              <span className={`w-10 flex-none text-right font-mono text-[12px] font-semibold ${r.rank === 1 ? "text-brand-strong" : "text-ink"}`}>
                {r.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
