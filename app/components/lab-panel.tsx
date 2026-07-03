"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { getLab, nextLab } from "@/lib/labs";
import { rulesForLab } from "@/lib/access-rules";
import { CheckoutSheet } from "@/components/checkout-sheet";
import { useLabWorkspace, type ObjectiveStatus } from "@/components/lab-workspace";
import { CertificateButton } from "@/components/certificate-button";

// Where "contact support" links go (the marketing contact page — WhatsApp + form).
const SUPPORT_URL = "https://shieldsyncsecurity.com/contact";

// ── animated terminal log lines ──────────────────────────────────────────────

const WIPE_LOG: { ms: number; text: string }[] = [
  { ms: 0,    text: "revoking learner console session…" },
  { ms: 1300, text: "running full account wipe…" },
  { ms: 3000, text: "scanning all resource types…" },
];

function TerminalLog({
  lines,
  shown,
  color,
}: {
  lines: typeof WIPE_LOG;
  shown: number;
  color: "green" | "orange";
}) {
  const textClass = color === "green" ? "text-emerald-400" : "text-orange-400";
  const cursorClass = color === "green" ? "bg-emerald-400" : "bg-orange-400";
  return (
    <div className="mt-3 min-h-[80px] rounded-xl bg-[#0f172a] px-4 py-3 font-mono text-xs">
      {lines.slice(0, shown).map((line, i) => (
        <div
          key={i}
          className={`leading-6 ${textClass}`}
          style={{ opacity: i < shown - 1 ? 0.55 : 1 }}
        >
          <span className="mr-2 text-slate-600">$</span>
          {line.text}
        </div>
      ))}
      <span
        className={`inline-block h-3.5 w-1.5 align-middle animate-pulse ${cursorClass}`}
      />
    </div>
  );
}

function useStaggeredLog(log: typeof WIPE_LOG) {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const timers = log.slice(1).map((line, i) =>
      setTimeout(() => setShown(i + 2), line.ms)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown;
}

// Seconds since mount — used to reassure during a cold build (which can run
// ~90s–2min) so the wait never reads as "stuck".
function useElapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return s;
}

type Objective = { id: string; description: string };
type BuildProgress = { done: number; total: number; current: string | null };
type Session = { status: string; expiresAt?: string | null; accountId?: string; error?: string; progress?: BuildProgress };

function fmt(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Format the "next run unlocks" ISO time into the learner's LOCAL time + a rough
// relative ("in about 6 h"). Returns null when there's no usable timestamp so the
// caller can fall back to the generic wording.
function fmtRetry(iso: string | null): { exact: string; rel: string } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const exact = new Date(t).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const mins = Math.max(0, Math.round((t - Date.now()) / 60000));
  const rel =
    mins < 60 ? `about ${mins} min` :
    mins < 60 * 24 ? `about ${Math.round(mins / 60)} h` :
    `about ${Math.round(mins / 60 / 24)} day${Math.round(mins / 60 / 24) === 1 ? "" : "s"}`;
  return { exact, rel };
}
const card = "rounded-2xl border border-line bg-surface p-5 shadow-sm";
// Shared button styles — a branded gradient primary (premium feel, matches the
// marketing site) + a quiet secondary. Presentational only.
const btnPrimary =
  "w-full rounded-xl bg-gradient-to-r from-brand to-cyan px-5 py-3 text-center text-base font-semibold text-white shadow-sm shadow-brand/20 transition hover:brightness-110 disabled:opacity-60";
const btnSecondary =
  "w-full rounded-xl border border-line-strong px-5 py-2.5 text-base font-semibold text-ink transition hover:bg-canvas";

function LeasingCard({ progress, onCancel }: { progress?: BuildProgress; onCancel?: () => void }) {
  const elapsed = useElapsed();
  const total = progress?.total ?? 0;
  const determinate = total > 0;
  const done = determinate ? Math.min(progress?.done ?? 0, total) : 0;
  // Real fraction, floored so the bar never reads empty and capped < 100 until the
  // session actually flips to "active" — so we never show a premature "done" that
  // then sits waiting on the final custom-resource (data seeding).
  const pct = determinate ? Math.min(97, Math.max(6, Math.round((done / total) * 90) + 6)) : 0;

  // One honest status line under the bar, driven by the REAL stack state.
  const phase = !determinate
    ? "Acquiring your isolated AWS account…"
    : done >= total
    ? "Finalizing — minting secure console access…"
    : progress?.current
    ? `Provisioning resources — now creating your ${progress.current}`
    : "Provisioning lab resources…";

  // Console feed — real CloudFormation milestones (not a timer).
  const lines: string[] = [
    "sandbox account acquired · us-east-1",
    "deploying lab scenario (CloudFormation)",
    ...(determinate
      ? done >= total
        ? [`${total} of ${total} resources ready ✓`, "minting time-boxed console access…"]
        : [
            ...(progress?.current ? [`creating ${progress.current}…`] : []),
            `${done} of ${total} resources ready`,
          ]
      : ["stack → CREATE_IN_PROGRESS"]),
  ];

  // Reassurance escalates with elapsed time so a slow cold build (a fresh AWS
  // account + CloudFormation can take 1–2 min) never looks frozen.
  const reassure =
    elapsed < 25
      ? "Spinning up a brand-new, isolated AWS account just for you — you can leave this tab; it'll be ready when you're back."
      : elapsed < 75
      ? "A cold build usually takes 1–2 minutes. This is normal — hang tight."
      : "Still working — some builds run a little longer. We haven't lost you; feel free to come back to this tab.";

  return (
    <div className={card} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 flex-none rounded-full bg-brand animate-pulse" />
          <span className="text-sm font-bold text-ink">Building your lab</span>
        </div>
        {/* Real count when we have it, else the elapsed clock — both prove it's live. */}
        <span className="font-mono text-xs font-semibold tabular-nums text-muted" aria-hidden>
          {determinate ? `${done}/${total}` : fmt(elapsed)}
        </span>
      </div>

      {/* dark console — REAL milestone lines */}
      <div className="mt-3 min-h-[72px] rounded-xl bg-[#0f172a] px-4 py-3 font-mono text-xs">
        {lines.map((t, i) => (
          <div
            key={i}
            className="leading-6 text-emerald-400"
            style={{ opacity: i < lines.length - 1 ? 0.55 : 1 }}
          >
            <span className="mr-2 text-slate-600">$</span>
            {t}
          </div>
        ))}
        <span className="inline-block h-3.5 w-1.5 align-middle animate-pulse bg-emerald-400" />
      </div>

      {/* progress bar — determinate from real resource counts, else indeterminate */}
      {determinate ? (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-cyan transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="ss-bar-track mt-3">
          <div className="ss-bar-fill ss-bar-brand" />
        </div>
      )}

      <p className="mt-2 text-xs font-medium text-ink-soft">{phase}</p>
      <p className="mt-1 text-xs text-muted">{reassure}</p>
      {onCancel && (
        <button onClick={onCancel} className="mt-3 text-sm font-semibold text-muted hover:text-ink">
          Cancel
        </button>
      )}
    </div>
  );
}

function EndingCard() {
  const shown = useStaggeredLog(WIPE_LOG);
  return (
    <div className={card} role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 flex-none rounded-full bg-[#ef4444] animate-pulse" />
        <span className="text-sm font-bold text-ink">Wiping your lab clean</span>
      </div>
      <TerminalLog lines={WIPE_LOG} shown={shown} color="orange" />
      <div className="ss-bar-track mt-3">
        <div className="ss-bar-fill ss-bar-red" />
      </div>
      <p className="mt-2.5 text-xs text-muted">
        Full account wipe in progress · this usually takes a minute
      </p>
    </div>
  );
}

export function LabPanel({ slug, objectives, ready }: { slug: string; objectives: Objective[]; ready: boolean }) {
  const { user, loading, hasAccess, refreshEntitlements } = useAuth();
  const { setLaunched, setObjectiveStatus, setGradePassed, sessionStartedAt, setSessionStartedAt } = useLabWorkspace();
  const key = `lab:${slug}`;
  const [showCheckout, setShowCheckout] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [flash, setFlash] = useState<"nocapacity" | "freebusy" | "limitreached" | "alreadyactive" | "launcherror" | null>(null);
  const [flashLab, setFlashLab] = useState<string | null>(null);
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<{ gradable: boolean; passed: boolean; criteria: { id: string; description: string; passed: boolean; unknown?: boolean }[] } | null>(null);
  const [grading, setGrading] = useState(false); // manual "Check my work" in flight
  const [autoGrading, setAutoGrading] = useState(false); // silent auto re-grade in flight
  const gradeInFlight = useRef(false); // one grade at a time (manual OR auto)
  const lastGradedAtRef = useRef(0); // debounce the on-return opportunistic re-grade
  const [copyStatus, setCopyStatus] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [consoleOpening, setConsoleOpening] = useState(false); // "Open AWS console" in flight
  const [consoleError, setConsoleError] = useState(false); // console mint failed (don't fail silently)
  const [wantsLaunch, setWantsLaunch] = useState(false);
  const [freeNextAt, setFreeNextAt] = useState<string | null>(null); // when a free slot frees up
  const [freeWait, setFreeWait] = useState(0); // seconds until then
  const [freePos, setFreePos] = useState(0); // place in line (1-based; 0 = unknown)
  const [freeWaiting, setFreeWaiting] = useState(0); // total people waiting
  const [limitReason, setLimitReason] = useState<string | null>(null); // which 429 cap
  const [limitRetryAt, setLimitRetryAt] = useState<string | null>(null); // exact ISO time the next run frees up
  const expiryFired = useRef(false);
  const autoLaunched = useRef(false);
  const freeRetry = useRef(false);
  const restoredFromServer = useRef(false);
  const redirecting = useRef(false);
  const consoleWindowRef = useRef<Window | null>(null);
  const lab = getLab(slug);
  // Launch policy (per-lab, from the single source the engine mirrors) — shown
  // up front so the cap isn't a surprise only when you hit it.
  const rule = lab ? rulesForLab(lab.level, lab.free) : null;
  const launchPolicy = rule ? `${rule.maxLaunches} launch${rule.maxLaunches === 1 ? "" : "es"} every ${rule.windowHours}h` : "";

  function clearSession() {
    setSessionId(null);
    setSession(null);
    setRated(null);
    expiryFired.current = false;
    consoleWindowRef.current = null;
    try { sessionStorage.removeItem(key); } catch {}
  }

  // restore a session id on mount — the server tells us its TRUE state via polling
  useEffect(() => {
    try {
      const sid = sessionStorage.getItem(key);
      if (sid) setSessionId(sid);
    } catch {}
  }, [key]);

  // Server-authoritative restore: if signed in and we DON'T already know a session
  // (fresh tab / different device / cleared sessionStorage), ask the server whether
  // this user has a live lab for this slug and adopt it. Closes the per-tab gap.
  useEffect(() => {
    if (restoredFromServer.current || loading || !user || sessionId) return;
    try { if (sessionStorage.getItem(key)) return; } catch {}
    restoredFromServer.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/active-session?labSlug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { session?: { sessionId?: string } | null };
        if (d.session?.sessionId) {
          try { sessionStorage.setItem(key, d.session.sessionId); } catch {}
          setSessionId(d.session.sessionId); // → polling restores the live lab
        }
      } catch {}
    })();
  }, [loading, user, sessionId, slug, key]);

  // poll the server for the session's real status (the single source of truth)
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!alive) return;
      try {
        const r = await fetch(`/api/session/${sessionId}`, { cache: "no-store" });
        if (r.status === 404) { clearSession(); return; }
        if (r.ok) {
          const s = (await r.json()) as Session;
          // Don't revert an optimistic "ending" back to "active" — wait for server to confirm
          setSession((prev) => (prev?.status === "ending" && s.status === "active" ? prev : s));
          if (s.status === "done" || s.status === "error") return; // terminal — stop polling
        }
      } catch { /* transient — keep polling */ }
      // 5s (was 3s): matches the engine's ~4.5s CFN-progress write cadence, so a
      // faster poll gains nothing but ~40% more requests. Cuts Worker request
      // volume (the Free-plan 100k/day ceiling) with no UX cost.
      if (alive) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // countdown to the session's real expiry
  useEffect(() => {
    if (!session?.expiresAt) { setRemaining(0); return; }
    const end = new Date(session.expiresAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session?.expiresAt]);

  // auto-end when the window runs out (fires once)
  useEffect(() => {
    if (remaining === 0 && session?.status === "active" && session?.expiresAt && !expiryFired.current) {
      expiryFired.current = true;
      void endLab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, session?.status]);

  // Tell the guide when a lab is live so it can reveal the full walkthrough
  // (progressive disclosure). A live session = leasing/active/ending.
  useEffect(() => {
    const s = session?.status;
    setLaunched(s === "leasing" || s === "active" || s === "ending");
  }, [session?.status, setLaunched]);

  // Mirror the session-active moment into context as a client-observed timestamp
  // (the server doesn't hand us a startedAt) — purely for the guide's "elapsed since
  // verified" display on the completion card. Cleared when the session ends so a
  // fresh lab run gets a fresh clock.
  useEffect(() => {
    const s = session?.status;
    if (s === "active" && !sessionStartedAt) setSessionStartedAt(new Date().toISOString());
    if (!s || s === "done" || s === "error") {
      setSessionStartedAt(null);
      setObjectiveStatus({});
      setGradePassed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  // ── Real-time auto-grading ─────────────────────────────────────────────────
  // While the lab is live, quietly re-score the account every ~25s so the
  // objectives tick green AS the learner fixes things — no need to hit "Check my
  // work". Pauses while the tab is hidden (saves cross-account calls), re-checks
  // opportunistically the moment they switch back (they likely just fixed
  // something in the console tab), and stops once everything passes. The manual
  // button stays an instant override. A grade is read-only (~10 AWS calls) and
  // the pool caps concurrent labs at 3, so this is negligible load.
  useEffect(() => {
    if (session?.status !== "active" || grade?.passed) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(loop, 25000);
    };
    async function loop() {
      if (!alive) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        await runGrade({ silent: true });
      }
      if (alive) schedule();
    }
    const onVisible = () => {
      if (!alive || document.visibilityState !== "visible") return;
      // debounce: don't re-grade if we just did (avoids a flurry on tab-flipping)
      if (Date.now() - lastGradedAtRef.current > 8000) void runGrade({ silent: true });
    };
    schedule(); // first auto-grade ~25s in — gives them time to start working
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, grade?.passed, sessionId]);

  async function launch() {
    setFlash(null);
    setSession({ status: "leasing" }); // optimistic provisioning view
    try {
      const r = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user!.id, labSlug: slug }),
      });
      if (r.status === 503) {
        const d = await r.json().catch(() => ({}));
        setSession(null);
        if (d.error === "FREE_AT_CAPACITY") {
          setFreeNextAt(typeof d.nextFreeAt === "string" ? d.nextFreeAt : null);
          if (typeof d.position === "number") setFreePos(d.position);
          if (typeof d.waiting === "number") setFreeWaiting(d.waiting);
          setFlash("freebusy");
        } else {
          setFlash("nocapacity");
        }
        return;
      }
      if (r.status === 429) {
        const d = await r.json().catch(() => ({}));
        setSession(null);
        setLimitReason(typeof d.error === "string" ? d.error : "LIMIT_REACHED");
        setLimitRetryAt(typeof d.retryAt === "string" ? d.retryAt : null);
        setFlash("limitreached");
        return;
      }
      if (r.status === 409) {
        const d = await r.json().catch(() => ({}));
        setSession(null);
        setFlashLab(typeof d.labSlug === "string" ? d.labSlug : null);
        setFlash("alreadyactive");
        return;
      }
      if (!r.ok) { setSession(null); setFlash("launcherror"); return; }
      const d = (await r.json()) as { sessionId: string; expiresAt?: string };
      try { sessionStorage.setItem(key, d.sessionId); } catch {}
      setSession({ status: "leasing", expiresAt: d.expiresAt });
      setSessionId(d.sessionId); // starts polling
    } catch { setSession(null); setFlash("launcherror"); }
  }

  async function openConsole() {
    setConsoleError(false);
    setConsoleOpening(true);
    // open the tab synchronously (popup-blocker safe), then redirect it to the fresh URL
    const w = window.open("", "_blank");
    if (w) w.document.write("<p style='font-family:sans-serif;padding:2rem;color:#334155'>Opening your AWS lab…</p>");
    consoleWindowRef.current = w; // keep ref so we can log out on wipe
    const fail = () => {
      // never fail silently — the pre-opened tab vanishing with no message was a real
      // "did it break?" moment for users. Close it and show an inline explanation.
      if (w) w.close();
      consoleWindowRef.current = null;
      setConsoleError(true);
      setTimeout(() => setConsoleError(false), 10000);
    };
    try {
      const r = await fetch("/api/console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.consoleUrl) { if (w) w.location.href = d.consoleUrl; else window.open(d.consoleUrl, "_blank"); }
      else fail();
    } catch {
      fail();
    } finally {
      setConsoleOpening(false);
    }
  }

  // Mint a FRESH console URL and copy it to the clipboard so the user can paste
  // it into an incognito window (avoids the "you must log out first" error when
  // their browser already holds an AWS session). The URL is time-boxed by STS,
  // so we mint it on-demand rather than caching one.
  async function copyConsoleUrl() {
    if (!sessionId || copyStatus === "loading") return;
    setCopyStatus("loading");
    try {
      const r = await fetch("/api/console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await r.json();
      if (!d?.consoleUrl) throw new Error("no url");
      await navigator.clipboard.writeText(d.consoleUrl);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 4000);
    } catch {
      setCopyStatus("error");
      setTimeout(() => setCopyStatus("idle"), 4000);
    }
  }

  function endLab() {
    if (!sessionId) return;
    // Immediately log out and close the AWS console tab
    const cw = consoleWindowRef.current;
    if (cw && !cw.closed) {
      try { cw.location.href = "https://console.aws.amazon.com/console/logout!doLogout"; } catch {}
      setTimeout(() => { try { cw.close(); } catch {} }, 2000);
    }
    consoleWindowRef.current = null;
    setSession((s) => (s ? { ...s, status: "ending" } : s)); // instant UI feedback
    fetch("/api/end-lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => {
        if (!r.ok) return; // engine refused — see catch-equivalent below
        // Engine has acknowledged — nuke runs in background; show "Lab ended" now
        setSession({ status: "done" });
        setSessionId(null); // stops polling
        try { sessionStorage.removeItem(key); } catch {}
      })
      .catch(() => {});
    // NOTE: on a non-OK response or network error we deliberately do NOT force
    // "done" — claiming "wiped clean" while the account may still be live is the
    // dangerous lie. We keep the optimistic "ending" view and leave polling on so
    // the server's real status resolves it (the reaper backstops teardown).
  }

  function rate(value: "up" | "down") {
    setRated(value); // optimistic
    // Persist for product signal (fire-and-forget; never blocks the UI).
    void fetch("/api/rate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labSlug: slug, rating: value }),
    }).catch(() => {});
  }

  // Single grade path shared by the manual button and the live auto-grader.
  // `silent` = the background poll: it shows a subtle spinner (not the big button
  // label) and, crucially, NEVER clears an existing grade on a transient error —
  // a momentary AWS blip must not wipe the objectives the learner already ticked.
  async function runGrade({ silent }: { silent: boolean }) {
    if (!sessionId || gradeInFlight.current) return;
    gradeInFlight.current = true;
    if (silent) setAutoGrading(true);
    else setGrading(true);
    try {
      const r = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (r.ok) {
        const g = await r.json();
        setGrade(g);
        lastGradedAtRef.current = Date.now();
        // Mirror the result into shared context — read-only broadcast for the guide
        // (step-verification + completion card). Does not affect grading itself.
        if (g?.gradable && Array.isArray(g.criteria)) {
          setObjectiveStatus(
            Object.fromEntries(
              g.criteria.map((c: { id: string; passed: boolean; unknown?: boolean }) => [
                c.id,
                c.unknown ? "unknown" : c.passed ? "pass" : "fail",
              ])
            )
          );
          setGradePassed(!!g.passed);
        }
      } else if (!silent) {
        setGrade(null); // manual check surfaces failure; auto keeps the prior grade
      }
    } catch {
      if (!silent) setGrade(null);
    } finally {
      gradeInFlight.current = false;
      if (silent) setAutoGrading(false);
      else setGrading(false);
    }
  }

  const checkWork = () => runGrade({ silent: false });

  // Dev-only preview hatch (paired with lab-workspace.tsx's ?ssgrade parsing): once
  // that hatch has seeded objectiveStatus from the URL, decide whether it covered
  // ALL of this lab's objectives — if so, flip gradePassed too, so the completion
  // card is reachable without a live grade. Needs `objectives` (this component's
  // prop) to know the lab's full objective set, so it's computed here rather than
  // in lab-workspace.tsx (which is deliberately lab-agnostic).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    try {
      const raw = new URLSearchParams(window.location.search).get("ssgrade");
      if (!raw) return;
      const ids = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
      if (objectives.length > 0 && objectives.every((o) => ids.has(o.id))) setGradePassed(true);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the wizard's ?intent=launch handoff once (client-only → no hydration mismatch).
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("intent") === "launch") setWantsLaunch(true);
    } catch {}
  }, []);

  // Auto-launch when the learner arrives from the marketing wizard with
  // ?intent=launch, once they're signed in and entitled. Turns the funnel handoff
  // into a single sign-in with no extra "Launch" click. Guarded so it fires at most
  // once and never double-leases (waits out the sessionStorage restore race).
  useEffect(() => {
    if (!wantsLaunch || autoLaunched.current) return;
    if (!user || !hasAccess(slug)) return;          // wait for auth + entitlements
    if (sessionId || session) return;               // already in a session/flow
    try { if (sessionStorage.getItem(key)) return; } catch {} // restore-race guard
    autoLaunched.current = true;
    // Strip the param so a refresh / back-nav can't relaunch.
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("intent");
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch {}
    void launch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLaunch, user, sessionId, session, slug, hasAccess]);

  // Arrived with intent=launch but NOT signed in → send straight to Google sign-in,
  // returning here (with the intent) to auto-launch. Without this the learner would
  // just see a duplicate "Sign in & launch" button and the funnel looks like a no-op.
  useEffect(() => {
    if (!wantsLaunch || loading || user || redirecting.current) return;
    redirecting.current = true;
    const returnTo = `/labs/${slug}?intent=launch`;
    window.location.href = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  }, [wantsLaunch, loading, user, slug]);

  // Wait-room countdown: when free labs are at capacity, count down to the soonest
  // free slot (nextFreeAt) and AUTO-RETRY the launch when it hits 0. If still busy,
  // /launch returns a fresh nextFreeAt and the countdown restarts. (Upper bound —
  // a slot can free sooner if a learner finishes early; the retry catches that too.)
  useEffect(() => {
    if (flash !== "freebusy" || !freeNextAt) { setFreeWait(0); return; }
    freeRetry.current = false;
    const end = new Date(freeNextAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setFreeWait(s);
      if (s === 0 && !freeRetry.current) {
        freeRetry.current = true;
        void launch();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, freeNextAt]);

  // Wait-room poll: while in line, refresh place + the soonest-free time, and grab
  // a seat the moment one opens (even before the countdown elapses — someone may
  // finish early). Also keeps this waiter's queue TTL alive. ~every 12s.
  useEffect(() => {
    if (flash !== "freebusy") return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/queue?labSlug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (stop || !r.ok) return;
        const d = (await r.json()) as { reached?: boolean; nextFreeAt?: string | null; position?: number; waiting?: number };
        if (stop) return;
        if (typeof d.nextFreeAt === "string") setFreeNextAt(d.nextFreeAt);
        if (typeof d.position === "number") setFreePos(d.position);
        if (typeof d.waiting === "number") setFreeWaiting(d.waiting);
        if (d.reached === false && !freeRetry.current) {
          freeRetry.current = true;
          void launch(); // a seat opened — claim it now
        }
      } catch {}
    };
    const t = setInterval(poll, 12000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, slug]);

  // ---------------- views ----------------
  if (!ready) return <div className={`${card} text-base text-ink-soft`}>This lab is coming soon.</div>;

  // Auth still resolving, or about to bounce an intent=launch arrival to sign-in —
  // show a neutral "signing in" state, never the duplicate sign-in button.
  if (loading || (wantsLaunch && !user)) {
    return (
      <div className={card} role="status" aria-live="polite">
        <p className="text-base font-extrabold text-ink">{wantsLaunch && !user ? "Taking you to sign-in…" : "Loading…"}</p>
        {wantsLaunch && !user && (
          <p className="mt-1 text-base text-ink-soft">One quick Google sign-in and your free lab launches automatically.</p>
        )}
      </div>
    );
  }

  if (flash === "nocapacity") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">All seats busy</p>
        <p className="mt-1 text-base text-ink-soft">Every isolated account is in use — one frees up as soon as a learner finishes. Give it a minute and try again.</p>
        <button onClick={() => { setFlash(null); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Try again</button>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="mt-3 block text-center text-sm font-semibold text-ink-soft hover:text-ink hover:underline">
          Stuck for a while? Contact support →
        </a>
      </div>
    );
  }
  if (flash === "freebusy") {
    const waiting = !!freeNextAt && freeWait > 0;
    return (
      <div className={card} role="status" aria-live="polite">
        <p className="text-base font-extrabold text-ink">Free labs are busy right now</p>
        {freePos >= 1 && (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-brand/30 bg-brand/5 p-3">
            <span className="text-sm font-semibold text-ink-soft">Your place in line</span>
            <span className="text-base font-bold text-brand">
              {freeWaiting > 1 ? `#${freePos} of ${freeWaiting}` : "You're first in line"}
            </span>
          </div>
        )}
        {waiting ? (
          <>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-canvas p-3">
              <span className="text-sm font-semibold text-ink-soft">A spot should open in</span>
              <span className="font-mono text-lg font-bold text-brand">{fmt(freeWait)}</span>
            </div>
            <div className="ss-bar-track mt-3">
              <div className="ss-bar-fill ss-bar-brand" />
            </div>
            <p className="mt-2.5 text-sm text-ink-soft">
              Keep this tab open — we&apos;ll start your lab <strong>automatically</strong> the moment one frees up.
              (It may open sooner if someone finishes early.)
            </p>
          </>
        ) : (
          <p className="mt-1 text-base text-ink-soft">
            Every free seat is in use right now. We&apos;ll keep checking — hold on a moment, or grab a paid lab for guaranteed access.
          </p>
        )}
        <button onClick={() => { setFlash(null); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Try now</button>
      </div>
    );
  }
  if (flash === "limitreached") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">
          {limitReason === "RATE_LIMITED" ? "Too many launches just now" : limitReason === "FREE_IP_LIMIT" ? "Free lab limit reached for your network" : "You've used all your launches"}
        </p>
        <p className="mt-1 text-base text-ink-soft">
          {limitReason === "RATE_LIMITED"
            ? "We saw a burst of launches from your network. Give it a couple of minutes, then try again. Monthly members skip these limits."
            : limitReason === "FREE_IP_LIMIT"
            ? "The free lab is one run per person — and it's been used several times from your network already. Try again later, or unlock a paid lab for instant, unlimited access. Monthly members skip these limits."
            : (() => {
                const retry = fmtRetry(limitRetryAt);
                const base = lab?.free
                  ? retry
                    ? `The free lab is ${launchPolicy}. Your next run unlocks at ${retry.exact} (${retry.rel} from now).`
                    : `The free lab includes ${launchPolicy}. It resets on a rolling ${rule?.windowHours}-hour window — your next run frees up about ${rule?.windowHours}h after your last one.`
                  : retry
                  ? `You've used all your launches for this lab (${launchPolicy}). Your next run unlocks at ${retry.exact} (${retry.rel} from now).`
                  : `You've used all your launches for this lab (${launchPolicy}). It resets on a rolling ${rule?.windowHours}-hour window — check back a little later.`;
                return `${base} Monthly members skip these limits.`;
              })()}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button onClick={() => setFlash(null)} className="w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">OK</button>
          <a
            href="https://shieldsyncsecurity.com/labs-wizard"
            className="block w-full rounded-xl px-5 py-2.5 text-center text-base font-semibold text-brand hover:underline"
          >
            See plans →
          </a>
        </div>
      </div>
    );
  }
  if (flash === "alreadyactive") {
    const otherTitle = flashLab ? getLab(flashLab)?.title ?? flashLab : null;
    const otherIsThis = !flashLab || flashLab === slug;
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">You already have a lab running</p>
        <p className="mt-1 text-base text-ink-soft">
          {otherIsThis
            ? "This lab is already starting in another tab. End it before launching again."
            : `Your “${otherTitle}” lab is still live. You can only run one lab at a time — end it first, then start this one.`}
        </p>
        {!otherIsThis && flashLab && (
          <Link href={`/labs/${flashLab}`} className="mt-4 block rounded-xl bg-brand px-5 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong">
            Go to your live lab
          </Link>
        )}
        <button onClick={() => setFlash(null)} className="mt-3 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">OK</button>
      </div>
    );
  }
  if (flash === "launcherror") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">Couldn&apos;t start the lab</p>
        <p className="mt-1 text-base text-ink-soft">
          That was most likely a brief hiccup on our side — nothing you did. Give it another try; it usually
          works on the second go.
        </p>
        <button onClick={() => { setFlash(null); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Try again</button>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="mt-3 block text-center text-sm font-semibold text-ink-soft hover:text-ink hover:underline">
          Still stuck? Contact support →
        </a>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Start this lab</p>
        <p className="mt-1 text-base text-ink-soft">Sign in to spin up your own isolated AWS lab.</p>
        <Link href={`/sign-in?returnTo=${encodeURIComponent(`/labs/${slug}`)}`} className={`mt-4 block ${btnPrimary}`}>Sign in to start</Link>
      </div>
    );
  }

  if (!hasAccess(slug)) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Get this lab</p>
        <p className="mt-1 text-base text-ink-soft">One-time purchase — simulated checkout, 24h access.</p>
        <button onClick={() => setShowCheckout(true)} className={`mt-4 ${btnPrimary}`}>Get this lab</button>
        {showCheckout && (
          <CheckoutSheet labSlug={slug} labTitle={lab?.title ?? "Lab"} plan="per-lab" onClose={() => setShowCheckout(false)} onPaid={async () => { await refreshEntitlements(); setShowCheckout(false); }} />
        )}
      </div>
    );
  }

  const status = session?.status;

  if (status === "leasing") {
    return <LeasingCard progress={session?.progress} onCancel={endLab} />;
  }

  if (status === "ending") {
    return <EndingCard />;
  }

  if (status === "error") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-semibold text-[#b91c1c]">The lab failed to start.</p>
        {session?.error && <p className="mt-1 break-words text-xs text-muted">{session.error}</p>}
        <button onClick={() => { clearSession(); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Try again</button>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className={card} role="status" aria-live="polite">
        <p className="text-base font-extrabold text-ink">⏹ Lab ended</p>
        <p className="mt-1 text-base text-ink-soft">Your account was wiped clean — nothing you did persists anywhere.</p>
        {/* The IAM revoke kills the federated AWS API session, but the BROWSER
            tab can still look normal until the user clicks something. If they
            opened the console via Copy-URL into an incognito window, our app
            never had a reference to that window so it didn't get auto-closed.
            Tell them to close it explicitly. */}
        <div className="mt-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-2.5 text-xs text-[#92400e]">
          🪟 <strong>Close any AWS console tabs you opened</strong> — their session was revoked, but the tab may look unchanged until you click. (The incognito copy-URL flow doesn’t auto-close.)
        </div>
        <button onClick={() => { clearSession(); void launch(); }} className={`mt-4 ${btnPrimary}`}>Start a new lab</button>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Did this lab help?</p>
          {rated ? (
            <p className="mt-2 text-base text-ink-soft">Thanks for the feedback! 🙌</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <button onClick={() => rate("up")} aria-label="Helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👍</button>
              <button onClick={() => rate("down")} aria-label="Not helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👎</button>
            </div>
          )}
        </div>
        {(() => {
          const next = nextLab(slug);
          if (!next) return null;
          return (
            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">Keep going</p>
              <p className="mt-2 text-base text-ink-soft">
                Next challenge: <strong className="text-ink">{next.title}</strong>{" "}
                <span className="text-sm text-muted">({next.level} · ~{next.estimatedActiveMinutes} min)</span>
              </p>
              <Link href={`/labs/${next.slug}`} className="mt-2 inline-block text-base font-semibold text-brand hover:underline">
                Open {next.title} →
              </Link>
            </div>
          );
        })()}
      </div>
    );
  }

  if (status === "active") {
    const low = remaining > 0 && remaining < 300;
    const graded = !!grade?.gradable;
    const doneCount = graded ? grade!.criteria.filter((c) => c.passed && !c.unknown).length : 0;
    const totalCount = graded ? grade!.criteria.filter((c) => !c.unknown).length : 0;
    return (
      <div className="overflow-hidden rounded-2xl border border-emerald-300/70 bg-surface shadow-sm ring-1 ring-emerald-500/10" role="status" aria-live="polite">
        {/* Live status bar — reads as "active" vs the gray idle card */}
        <div className="flex items-center justify-between gap-2 border-b border-emerald-200/60 bg-emerald-50/70 px-5 py-2.5">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-800">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Lab is live
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-sm font-bold tabular-nums ${low ? "bg-[#fee2e2] text-[#b91c1c]" : "bg-white text-emerald-700"}`}>
            <span aria-hidden>⏱</span> {fmt(remaining)}
          </span>
        </div>

        <div className="p-5">
        {low && (
          <div role="alert" className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2.5 text-sm font-semibold text-[#b91c1c]">
            ⚠ Under 5 minutes left — wrap up and click <strong>End &amp; wipe lab</strong>. When the timer hits 0 the account is auto-wiped and your work is cleared.
          </div>
        )}
        <button onClick={openConsole} disabled={consoleOpening} className={`${low ? "mt-3" : ""} block ${btnPrimary}`}>
          {consoleOpening ? "Opening console…" : "Open AWS console ↗"}
        </button>
        {consoleError && (
          <p role="alert" className="mt-2 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2.5 text-sm font-semibold text-[#b91c1c]">
            Couldn&apos;t open the console just yet — it may still be finishing setup. Give it a few seconds and click again, or use <strong>Copy URL for incognito</strong> below. Still stuck? <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline">Contact support</a>.
          </p>
        )}

        {/* Incognito helper — demoted to a collapsed disclosure (it's only needed when
            the browser already holds an AWS session; consoleError surfaces it inline too). */}
        <details className="mt-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-soft">
          <summary className="cursor-pointer list-none font-semibold text-ink">
            Console says “you must log out first”?
          </summary>
          <p className="mt-1.5">A browser holds one AWS session at a time. Open the lab in an <strong>incognito window</strong> (or sign out of your own AWS first):</p>
          <button
            onClick={copyConsoleUrl}
            disabled={copyStatus === "loading"}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-60"
          >
            {copyStatus === "loading"
              ? "Getting URL…"
              : copyStatus === "copied"
              ? "✓ Copied — paste in incognito"
              : copyStatus === "error"
              ? "Couldn’t copy — try again"
              : "Copy URL for incognito"}
          </button>
          <p className="mt-1 text-[11px] text-muted">
            Time-boxed and works once — paste it quickly into an incognito window.
          </p>
        </details>

        {/* The objectives ARE the scorecard: Check my work fills this very list in, so
            it's obvious what the button does. (objective.id === grade criterion.id) */}
        {objectives.length > 0 && (
          <div id="ss-check-work" tabIndex={-1} className="mt-5 rounded-xl border border-line bg-canvas p-4 outline-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted">What you’re fixing</p>
              <div className="flex items-center gap-2">
                {!grade?.passed && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                    title="We re-check your live AWS account automatically as you work"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className={`absolute inline-flex h-full w-full rounded-full bg-emerald-500 ${autoGrading ? "animate-ping opacity-75" : "opacity-0"}`} />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    {autoGrading ? "checking…" : "live"}
                  </span>
                )}
                {graded && (
                  <span className="font-mono text-xs font-bold text-brand">{doneCount}/{totalCount} done</span>
                )}
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {objectives.map((o) => {
                const c = graded ? grade!.criteria.find((x) => x.id === o.id) : undefined;
                const state = !c ? "idle" : c.unknown ? "unknown" : c.passed ? "pass" : "todo";
                return (
                  <li
                    key={o.id}
                    className={`flex gap-2 rounded-md px-1.5 py-1 text-sm transition-colors duration-500 ${state === "pass" ? "bg-emerald-50/70" : ""}`}
                  >
                    <span
                      className="mt-0.5 flex-none"
                      role="img"
                      aria-label={state === "pass" ? "Done:" : state === "unknown" ? "Couldn't check:" : state === "todo" ? "Not done yet:" : "Objective:"}
                    >
                      {state === "pass" ? "✅" : state === "unknown" ? "⚠️" : state === "todo" ? "⬜" : (
                        <span className="inline-block h-3 w-3 rounded-full border-2 border-muted align-middle" />
                      )}
                    </span>
                    <span className={`text-ink-soft transition-all duration-500 ${state === "pass" ? "line-through opacity-70" : ""}`}>{o.description}</span>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={checkWork}
              disabled={grading || autoGrading}
              className={`mt-4 ${btnPrimary}`}
            >
              {grading ? "Checking your live account…" : autoGrading ? "Auto-checking…" : grade ? "Re-check now" : "Check my work"}
            </button>
            <p className="mt-2 text-center text-xs text-muted">
              The ticks update <strong>automatically</strong> as you work — hit the button any time to check instantly.
            </p>
            {grade && (grade.gradable ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className={`text-sm font-bold ${grade.passed ? "text-[#15803d]" : "text-ink"}`}>
                  {grade.passed
                    ? "🎉 All fixes verified — nicely done!"
                    : doneCount === 0
                    ? "No fixes verified yet — work through the steps, then re-check."
                    : `${doneCount} of ${totalCount} fixes verified — ${totalCount - doneCount} to go.`}
                </p>
                {!grade.passed && (
                  <p className="mt-1 text-xs text-muted">✅ = verified done · ⬜ = still to do. Finish the ⬜ items in the console, then re-check.</p>
                )}
                {grade.criteria.some((c) => c.unknown) && (
                  <p className="mt-1 text-xs text-[#92400e]">⚠ Some checks couldn&apos;t run (a temporary AWS hiccup) — click “Re-check my work”.</p>
                )}
                {grade.passed && (
                  <CertificateButton
                    labSlug={slug}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand to-cyan px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/20 transition hover:brightness-110 disabled:opacity-60"
                  />
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">Auto-grading isn&apos;t available for this lab yet.</p>
            ))}
          </div>
        )}

        <button onClick={endLab} className={`mt-3 ${btnSecondary}`}>End &amp; wipe lab</button>
        </div>

        {/* Mobile-only sticky action bar: on phones the rail sits below the whole guide,
            so mirror the two primary actions at the bottom of the viewport. */}
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface/95 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
          <button onClick={openConsole} disabled={consoleOpening} className="flex-1 rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-70">
            {consoleOpening ? "Opening…" : "Open console ↗"}
          </button>
          <button id="ss-check-work-mobile" onClick={checkWork} disabled={grading || autoGrading} className="flex-1 rounded-xl bg-gradient-to-r from-brand to-cyan px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {grading || autoGrading ? "Checking…" : grade ? "Re-check" : "Check my work"}
          </button>
        </div>
      </div>
    );
  }

  // no session — idle (the conversion moment: make it inviting)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      {/* 3px brand gradient top edge */}
      <div className="h-[3px] w-full bg-gradient-to-r from-brand to-cyan" aria-hidden />
      {/* Accent header strip */}
      <div className="bg-gradient-to-r from-brand/[0.08] to-cyan/[0.04] px-5 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-cyan text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </span>
          <p className="text-base font-extrabold text-ink">Start this lab</p>
        </div>
        <p className="mt-1.5 text-sm leading-6 text-ink-soft">
          Your own isolated AWS account, the scenario pre-deployed, auto-wiped when you finish.
        </p>
      </div>

      <div className="p-5 pt-4">
        {/* Quick reassurance chips */}
        <ul className="grid gap-2">
          {[
            { i: "🔐", t: "Real, isolated AWS console — nothing shared" },
            { i: "🧹", t: "Auto-wiped when you're done — no setup, no bill" },
            { i: "✓", t: "Graded against your live account, not a checkbox" },
          ].map((c) => (
            <li key={c.t} className="flex items-start gap-2 text-sm text-ink-soft">
              <span aria-hidden className="mt-0.5 flex-none">{c.i}</span>
              {c.t}
            </li>
          ))}
        </ul>

        {rule && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink-soft">
            <span aria-hidden>↻</span>
            {lab?.free ? "Free lab" : lab?.level} · {launchPolicy} · ~{lab?.estimatedActiveMinutes ?? 30} min
          </p>
        )}

        <button onClick={launch} className={`mt-4 ${btnPrimary}`}>Launch lab →</button>
        <p className="mt-2 text-center text-xs text-muted">Opens the AWS console in a new tab; this guide stays here.</p>
      </div>
    </div>
  );
}
