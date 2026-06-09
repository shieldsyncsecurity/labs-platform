"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { getLab } from "@/lib/labs";
import { CheckoutSheet } from "@/components/checkout-sheet";

type Objective = { id: string; description: string };
type Session = { status: string; expiresAt?: string | null; accountId?: string; error?: string };

function fmt(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
const card = "rounded-2xl border border-line bg-surface p-5";

export function LabPanel({ slug, objectives, ready }: { slug: string; objectives: Objective[]; ready: boolean }) {
  const { user, hasAccess, refreshEntitlements } = useAuth();
  const key = `lab:${slug}`;
  const [showCheckout, setShowCheckout] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [flash, setFlash] = useState<"nocapacity" | "launcherror" | null>(null);
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const expiryFired = useRef(false);
  const lab = getLab(slug);

  function clearSession() {
    setSessionId(null);
    setSession(null);
    setRated(null);
    expiryFired.current = false;
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
      if (r.status === 503) { setSession(null); setFlash("nocapacity"); return; }
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
    try {
      const r = await fetch("/api/console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const d = await r.json();
      if (d.consoleUrl) { if (w) w.location.href = d.consoleUrl; else window.open(d.consoleUrl, "_blank"); }
      else if (w) w.close();
    } catch { if (w) w.close(); }
  }

  function endLab() {
    if (!sessionId) return;
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

  // ---------------- views ----------------
  if (!ready) return <div className={`${card} text-base text-ink-soft`}>This lab is coming soon.</div>;

  if (flash === "nocapacity") {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">All seats busy</p>
        <p className="mt-1 text-sm text-ink-soft">Every isolated account is in use — one frees up as soon as a learner finishes.</p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-ink hover:bg-canvas">Try again</button>
      </div>
    );
  }
  if (flash === "launcherror") {
    return (
      <div className={card}>
        <p className="text-base font-semibold text-[#b91c1c]">Couldn&apos;t start the lab.</p>
        <button onClick={() => setFlash(null)} className="mt-4 w-full rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-ink hover:bg-canvas">Retry</button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Start this lab</p>
        <p className="mt-1 text-sm text-ink-soft">Sign in to spin up your own isolated AWS lab.</p>
        <Link href="/sign-in" className="mt-4 block rounded-xl bg-brand px-5 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong">Sign in to start</Link>
      </div>
    );
  }

  if (!hasAccess(slug)) {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">Get this lab</p>
        <p className="mt-1 text-sm text-ink-soft">One-time purchase — simulated checkout, 24h access.</p>
        <button onClick={() => setShowCheckout(true)} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Get this lab</button>
        {showCheckout && (
          <CheckoutSheet labSlug={slug} labTitle={lab?.title ?? "Lab"} plan="per-lab" onClose={() => setShowCheckout(false)} onPaid={async () => { await refreshEntitlements(); setShowCheckout(false); }} />
        )}
      </div>
    );
  }

  const status = session?.status;

  if (status === "leasing") {
    return (
      <div className={card}>
        <p className="font-mono text-sm text-brand">▸ Building your lab…</p>
        <p className="mt-1 text-sm text-muted">Leasing a clean account and deploying the scenario. This runs on our side — you can even leave this tab; it&apos;ll be ready when you&apos;re back.</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-canvas">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
        </div>
      </div>
    );
  }

  if (status === "ending") {
    return <div className={`${card} font-mono text-sm text-brand`}>▸ Wiping your lab clean…</div>;
  }

  if (status === "error") {
    return (
      <div className={card}>
        <p className="text-base font-semibold text-[#b91c1c]">The lab failed to start.</p>
        {session?.error && <p className="mt-1 break-words text-xs text-muted">{session.error}</p>}
        <button onClick={() => { clearSession(); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Try again</button>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className={card}>
        <p className="text-base font-extrabold text-ink">⏹ Lab ended</p>
        <p className="mt-1 text-sm text-ink-soft">Your account was wiped clean and returned to the pool — nothing you did leaks to the next learner.</p>
        <button onClick={() => { clearSession(); void launch(); }} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Start a new lab</button>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">Did this lab help?</p>
          {rated ? (
            <p className="mt-2 text-sm text-ink-soft">Thanks for the feedback! 🙌</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <button onClick={() => setRated("up")} aria-label="Helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👍</button>
              <button onClick={() => setRated("down")} aria-label="Not helpful" className="rounded-lg border border-line px-4 py-2 text-base hover:bg-canvas">👎</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (status === "active") {
    const low = remaining > 0 && remaining < 300;
    return (
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold text-ink">🟢 Lab is live</span>
          <span className={`font-mono text-sm font-bold ${low ? "text-[#b91c1c]" : "text-brand"}`}>⏱ {fmt(remaining)}</span>
        </div>
        <button onClick={openConsole} className="mt-4 block w-full rounded-xl bg-brand px-5 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong">Open AWS console ↗</button>
        <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-soft">
          <p className="font-semibold text-ink">Already signed into AWS?</p>
          <p className="mt-1">A browser holds one AWS session at a time. If you see “you must log out first,” open this in an <strong>incognito window</strong> (or log out of AWS first).</p>
        </div>
        {objectives.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">Objectives</p>
            <ul className="mt-2 space-y-2">
              {objectives.map((o) => (
                <li key={o.id} className="flex gap-2 text-sm text-ink-soft">
                  <span className="mt-0.5 flex-none text-line-strong">○</span>
                  <span>{o.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button onClick={endLab} className="mt-5 w-full rounded-xl border border-line px-5 py-2.5 text-base font-semibold text-ink hover:bg-canvas">End &amp; wipe lab</button>
      </div>
    );
  }

  // no session — idle
  return (
    <div className={card}>
      <p className="text-base font-extrabold text-ink">Start this lab</p>
      <p className="mt-1 text-sm text-ink-soft">Your own isolated AWS account (~30 min), the scenario pre-deployed, auto-wiped when you finish.</p>
      <button onClick={launch} className="mt-4 w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white hover:bg-brand-strong">Launch lab</button>
      <p className="mt-2 text-xs text-muted">Opens the AWS console in a new tab; this guide stays here.</p>
    </div>
  );
}
