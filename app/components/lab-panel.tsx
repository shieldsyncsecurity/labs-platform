"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { getLab } from "@/lib/labs";
import { CheckoutSheet } from "@/components/checkout-sheet";

// ── animated terminal log lines ──────────────────────────────────────────────

const BUILD_LOG: { ms: number; text: string }[] = [
  { ms: 0,     text: "locating available sandbox account…" },
  { ms: 1300,  text: "account acquired · us-east-1" },
  { ms: 2500,  text: "guardrails verified  region-lock ✓  cost-cap ✓" },
  { ms: 3700,  text: "deploying lab scenario (CloudFormation)…" },
  { ms: 5400,  text: "stack → CREATE_IN_PROGRESS" },
  { ms: 11500, text: "resources creating  S3 · IAM · Lambda…" },
  { ms: 17500, text: "stack → CREATE_COMPLETE ✓" },
  { ms: 19000, text: "minting time-boxed console access…" },
];

const WIPE_LOG: { ms: number; text: string }[] = [
  { ms: 0,    text: "revoking learner console session…" },
  { ms: 1300, text: "running full account wipe (aws-nuke)…" },
  { ms: 3000, text: "scanning all resource types…" },
];

function TerminalLog({
  lines,
  shown,
  color,
}: {
  lines: typeof BUILD_LOG;
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

function useStaggeredLog(log: typeof BUILD_LOG) {
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

type Objective = { id: string; description: string };
type Session = { status: string; expiresAt?: string | null; accountId?: string; error?: string };

function fmt(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
const card = "rounded-2xl border border-line bg-surface p-5";

function LeasingCard() {
  const shown = useStaggeredLog(BUILD_LOG);
  return (
    <div className={card} role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 flex-none rounded-full bg-brand animate-pulse" />
        <span className="text-sm font-bold text-ink">Building your lab</span>
      </div>
      <TerminalLog lines={BUILD_LOG} shown={shown} color="green" />
      <div className="ss-bar-track mt-3">
        <div className="ss-bar-fill ss-bar-brand" />
      </div>
      <p className="mt-2.5 text-xs text-muted">
        us-east-1 · isolated AWS account · you can leave this tab — it&apos;ll be ready when you&apos;re back
      </p>
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
  const key = `lab:${slug}`;
  const [showCheckout, setShowCheckout] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [flash, setFlash] = useState<"nocapacity" | "freebusy" | "limitreached" | "launcherror" | null>(null);
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<{ gradable: boolean; passed: boolean; criteria: { id: string; description: string; passed: boolean }[] } | null>(null);
  const [grading, setGrading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [wantsLaunch, setWantsLaunch] = useState(false);
  const expiryFired = useRef(false);
  const autoLaunched = useRef(false);
  const redirecting = useRef(false);
  const consoleWindowRef = useRef<Window | null>(null);
  const lab = getLab(slug);

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
      if (alive) timer = setTimeout(tick, 3000);
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
        setFlash(d.error === "FREE_AT_CAPACITY" ? "freebusy" : "nocapacity");
        return;
      }
      if (r.status === 429) { setSession(null); setFlash("limitreached"); return; }
      if (!r.ok) { setSession(null); setFlash("launcherror"); return; }
      const d = (await r.json()) as { sessionId: string; expiresAt?: string };
      try { sessionStorage.setItem(key, d.sessionId); } catch {}
      setSession({ status: "leasing", expiresAt: d.expiresAt });
      setSessionId(d.sessionId); // starts polling
    } catch { setSession(null); setFlash("launcherror"); }
  }

  async function openConsole() {
    // open the tab synchronously (popup-blocker safe), then redirect it to the fresh URL
    const w = window.open("", "_blank");
    if (w) w.document.write("<p style='font-family:sans-serif;padding:2rem;color:#334155'>Opening your AWS lab…</p>");
    consoleWindowRef.current = w; // keep ref so we can log out on wipe
    try {
      const r = await fetch("/api/console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await r.json();
      if (d.consoleUrl) { if (w) w.location.href = d.consoleUrl; else window.open(d.consoleUrl, "_blank"); }
      else { if (w) w.close(); consoleWindowRef.current = null; }
    } catch { if (w) w.close(); consoleWindowRef.current = null; }
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
      .then(() => {
        // Engine has acknowledged — nuke runs in background; show "Lab ended" now
        setSession({ status: "done" });
        setSessionId(null); // stops polling
        try { sessionStorage.removeItem(key); } catch {}
      })
      .catch(() => {
        // Even on error, release the UI — reaper will clean up
        setSession({ status: "done" });
        setSessionId(null);
        try { sessionStorage.removeItem(key); } catch {}
      });
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

  async function checkWork() {
    if (!sessionId) return;
    setGrading(true);
    try {
      const r = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setGrade(r.ok ? await r.json() : null);
    } catch {
      setGrade(null);
    }
    setGrading(false);
  }

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
        <p className="mt-1 text-base text-ink-soft">Every isolated account is in use — one frees up as soon as a learner finishes.</p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">Try again</button>
      </div>
    );
  }
  if (flash === "freebusy") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">Free labs are at capacity</p>
        <p className="mt-1 text-base text-ink-soft">
          Free sessions are capped at a share of the pool so paid learners always have room. One opens up
          soon — try again in a few minutes, or get a paid lab for guaranteed access.
        </p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">Try again</button>
      </div>
    );
  }
  if (flash === "limitreached") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-extrabold text-ink">You&apos;ve used all your launches</p>
        <p className="mt-1 text-base text-ink-soft">
          You&apos;ve hit this lab&apos;s launch limit for now. It resets on a rolling window — check back a
          little later.
        </p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">OK</button>
      </div>
    );
  }
  if (flash === "launcherror") {
    return (
      <div className={card} role="alert">
        <p className="text-base font-semibold text-[#b91c1c]">Couldn&apos;t start the lab.</p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">Retry</button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Start this lab</p>
        <p className="mt-1 text-base text-ink-soft">Sign in to spin up your own isolated AWS lab.</p>
        <Link href={`/sign-in?returnTo=${encodeURIComponent(`/labs/${slug}`)}`} className="mt-4 block rounded-xl bg-brand px-5 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong">Sign in to start</Link>
      </div>
    );
  }

  if (!hasAccess(slug)) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Get this lab</p>
        <p className="mt-1 text-base text-ink-soft">One-time purchase — simulated checkout, 24h access.</p>
        <button onClick={() => setShowCheckout(true)} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Get this lab</button>
        {showCheckout && (
          <CheckoutSheet labSlug={slug} labTitle={lab?.title ?? "Lab"} plan="per-lab" onClose={() => setShowCheckout(false)} onPaid={async () => { await refreshEntitlements(); setShowCheckout(false); }} />
        )}
      </div>
    );
  }

  const status = session?.status;

  if (status === "leasing") {
    return <LeasingCard />;
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
        <p className="mt-1 text-base text-ink-soft">Your account was wiped clean and returned to the pool — nothing you did leaks to the next learner.</p>
        {/* The IAM revoke kills the federated AWS API session, but the BROWSER
            tab can still look normal until the user clicks something. If they
            opened the console via Copy-URL into an incognito window, our app
            never had a reference to that window so it didn't get auto-closed.
            Tell them to close it explicitly. */}
        <div className="mt-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] p-2.5 text-xs text-[#92400e]">
          🪟 <strong>Close any AWS console tabs you opened</strong> — their session was revoked, but the tab may look unchanged until you click. (The incognito copy-URL flow doesn’t auto-close.)
        </div>
        <button onClick={() => { clearSession(); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Start a new lab</button>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Did this lab help?</p>
          {rated ? (
            <p className="mt-2 text-sm text-ink-soft">Thanks for the feedback! 🙌</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <button onClick={() => rate("up")} aria-label="Helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👍</button>
              <button onClick={() => rate("down")} aria-label="Not helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👎</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status === "active") {
    const low = remaining > 0 && remaining < 300;
    return (
      <div className={card} role="status" aria-live="polite">
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold text-ink">🟢 Lab is live</span>
          <span className={`font-mono text-sm font-bold ${low ? "text-[#b91c1c]" : "text-brand"}`}>⏱ {fmt(remaining)}</span>
        </div>
        {low && (
          <div role="alert" className="mt-3 rounded-lg border border-[#fecaca] bg-[#fef2f2] p-2.5 text-sm font-semibold text-[#b91c1c]">
            ⚠ Under 5 minutes left — wrap up and click <strong>End &amp; wipe lab</strong>. When the timer hits 0 the account is auto-wiped and your work is cleared.
          </div>
        )}
        <button onClick={openConsole} className="mt-4 block w-full rounded-xl bg-brand px-5 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong">Open AWS console ↗</button>
        <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-sm text-ink-soft">
          <p className="font-semibold text-ink">Already signed into AWS?</p>
          <p className="mt-1">A browser holds one AWS session at a time. If you see “you must log out first,” open this in an <strong>incognito window</strong> (or log out of AWS first).</p>
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
            URL is time-boxed and only works once — paste it quickly into an incognito window.
          </p>
        </div>
        {objectives.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Objectives</p>
            <ul className="mt-2 space-y-2">
              {objectives.map((o) => (
                <li key={o.id} className="flex gap-2 text-base text-ink-soft">
                  {/* Proper circle: drawn as a 12×12 div with a 2px border so it
                      stays crisp at any zoom — the unicode ○ glyph rendered
                      effectively invisible. */}
                  <span
                    className="mt-1 flex-none h-3 w-3 rounded-full border-2 border-muted"
                    aria-hidden="true"
                  />
                  <span>{o.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 border-t border-line pt-4">
          <button
            onClick={checkWork}
            disabled={grading}
            className="w-full rounded-xl bg-ink px-5 py-2.5 text-base font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {grading ? "Checking your work…" : "✓ Check my work"}
          </button>
          {grade && (grade.gradable ? (
            <div className="mt-3">
              <p className={`text-sm font-bold ${grade.passed ? "text-[#15803d]" : "text-ink"}`}>
                {grade.passed
                  ? "🎉 All checks passed — nicely done!"
                  : `${grade.criteria.filter((c) => c.passed).length}/${grade.criteria.length} checks passing — keep going`}
              </p>
              <ul className="mt-2 space-y-2">
                {grade.criteria.map((c) => (
                  <li key={c.id} className="flex gap-2 text-sm">
                    <span className="mt-0.5 flex-none">{c.passed ? "✅" : "⬜"}</span>
                    <span className={`text-ink-soft ${c.passed ? "line-through" : ""}`}>{c.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Auto-grading isn&apos;t available for this lab yet.</p>
          ))}
        </div>
        <button onClick={endLab} className="mt-3 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">End &amp; wipe lab</button>
      </div>
    );
  }

  // no session — idle
  return (
    <div className={card}>
      <p className="text-base font-extrabold text-ink">Start this lab</p>
      <p className="mt-1 text-base text-ink-soft">Your own isolated AWS account (~30 min), the scenario pre-deployed, auto-wiped when you finish.</p>
      <button onClick={launch} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Launch lab</button>
      <p className="mt-2 text-xs text-muted">Opens the AWS console in a new tab; this guide stays here.</p>
    </div>
  );
}
