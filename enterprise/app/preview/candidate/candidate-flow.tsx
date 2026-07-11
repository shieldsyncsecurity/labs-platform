"use client";

/*
 * ShieldSync Enterprise — CANDIDATE FLOW (real front-end, Azure-first).
 *
 * This is the production UI layer of the candidate assessment, converted from
 * the design mock. It uses REAL browser APIs — getUserMedia (camera + mic
 * meter), feature-detection + a real bandwidth probe for the readiness check,
 * the Document Picture-in-Picture API for the floating companion (with a docked
 * fallback), and a real countdown timer.
 *
 * BACKEND IS SIMULATED here (provisioning, grading, slot capacity) and every
 * such seam is marked `// TODO(engine)`. The real cloud assessment is gated on
 * the dedicated labs Entra tenant (A0) + the ent-engine Azure driver — see
 * docs/CANDIDATE-FLOW-BUILD-STATUS.md. Hidden, noindex, unlinked route.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Step =
  | "invite" | "consent" | "readiness" | "otp" | "prebrief"
  | "booking" | "lobby" | "room" | "reflection" | "done";

const STEPS: { id: Step; label: string }[] = [
  { id: "invite", label: "Invite" },
  { id: "consent", label: "Consent" },
  { id: "readiness", label: "Readiness check" },
  { id: "otp", label: "Verify" },
  { id: "prebrief", label: "What to expect" },
  { id: "booking", label: "Book a slot" },
  { id: "lobby", label: "Get ready" },
  { id: "room", label: "Assessment room" },
  { id: "reflection", label: "Reflection" },
  { id: "done", label: "Done" },
];

const OBJECTIVES = [
  "Make the data storage private — at the root",
  "Enforce encryption & secure transfer",
  "Right-size the pipeline identity",
  "Move the secret into Key Vault",
  "Turn on the audit log",
];

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50";
const BTN_GHOST =
  "inline-flex items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong";

export default function CandidateFlow() {
  const [step, setStep] = useState<Step>("invite");
  const idx = STEPS.findIndex((s) => s.id === step);
  const go = useCallback((s: Step) => {
    setStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <div className="min-h-screen bg-[#eef1f5]">
      {/* preview scaffolding — not part of the product */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 bg-ink px-4 py-2 text-xs text-slate-300">
        <span className="font-bold text-amber-400">PREVIEW</span>
        <span className="hidden sm:inline">Real front-end · camera/mic/floating-window are live · backend simulated</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {STEPS.map((s) => (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              className={`rounded border px-2 py-0.5 text-[11px] ${
                s.id === step ? "border-brand bg-brand text-white" : "border-slate-600 bg-slate-800 text-slate-400"
              }`}
            >
              {STEPS.indexOf(s) + 1}. {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 pb-24">
        {step === "invite" && <Invite go={go} />}
        {step === "consent" && <Consent go={go} />}
        {step === "readiness" && <Readiness go={go} />}
        {step === "otp" && <Otp go={go} />}
        {step === "prebrief" && <PreBrief go={go} />}
        {step === "booking" && <Booking go={go} />}
        {step === "lobby" && <Lobby go={go} />}
        {step === "room" && <Room go={go} />}
        {step === "reflection" && <Reflection go={go} />}
        {step === "done" && <Done go={go} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shells */

function Device({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-[0_20px_50px_-28px_rgba(15,23,42,0.4)]">
      <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
        <span className="text-[15px] font-extrabold tracking-tight text-ink">
          Shield<span className="text-brand">Sync</span>
          <span className="ml-2 rounded-full border border-brand/40 px-1.5 py-0.5 align-[2px] text-[9px] font-bold uppercase tracking-[0.16em] text-brand">
            Enterprise
          </span>
        </span>
        <span className="text-xs text-muted">{title}</span>
      </div>
      <div className="px-6 py-7 sm:px-8">{children}</div>
    </div>
  );
}

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">{children}</p>
);

/* ------------------------------------------------------------- 1 invite */

function Invite({ go }: { go: (s: Step) => void }) {
  return (
    <>
      <Device title="📧 Inbox">
        <p className="text-xs text-muted">
          From <b className="font-mono text-ink">no-reply@shieldsyncsecurity.com</b>
        </p>
        <h1 className="mt-1.5 text-xl font-bold text-ink">Acme Corp invited you to a hands-on security assessment</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          Hi Priya — Acme Corp would like you to complete a <b>Cloud Security Engineer</b> assessment.
          It&apos;s a real, hands-on cloud environment (not a quiz), takes about 60 minutes, and you can
          do it on your own schedule.
        </p>
        <ul className="mt-4 space-y-2 text-[14px] text-ink-soft">
          <li>• Runs in your browser — nothing to install.</li>
          <li>• Do it whenever you&apos;re ready; book a slot that suits you.</li>
          <li>• Check your setup in 60 seconds before you start.</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className={BTN} onClick={() => go("consent")}>Start my assessment →</button>
          <button className={BTN_GHOST} onClick={() => go("readiness")}>Check my setup first</button>
        </div>
        <p className="mt-5 text-xs text-muted">This link is personal to you — please don&apos;t share it. Expires in 7 days.</p>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">
        The buttons are the &ldquo;magic link.&rdquo; The real link signs the candidate in and lands here.
      </p>
    </>
  );
}

/* ------------------------------------------------------------ 2 consent */

const CONSENTS = [
  <>
    <b>Your session is recorded.</b> Your webcam (periodic snapshots) and microphone are recorded so
    Acme&apos;s recruiter can confirm it&apos;s you. A human reviews it — no AI. Kept 30 days, then deleted.
  </>,
  <>
    <b>AI assistants &amp; docs are allowed</b> — use what you&apos;d use on the job. But you must work{" "}
    <b>alone</b>; a second person helping is not permitted.
  </>,
  <>The environment is <b>fully isolated</b> — nothing you do touches any real Acme system.</>,
  <>Your written answers are shown to the employer as-is, but <b>don&apos;t change your score</b>.</>,
];

function Consent({ go }: { go: (s: Step) => void }) {
  const [ticks, setTicks] = useState([false, false, false, false]);
  const all = ticks.every(Boolean);
  return (
    <>
      <Device title="Acme Corp">
        <Eyebrow>Cloud Security Engineer — hands-on assessment</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">Before you begin</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          You&apos;ll work in your own private cloud environment for 60 minutes, then a report goes to
          Acme Corp&apos;s hiring team. A few things to know and agree to first:
        </p>
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          {CONSENTS.map((c, i) => (
            <label key={i} className="flex cursor-pointer gap-2.5 py-2 text-[13.5px] text-ink-soft">
              <input
                type="checkbox"
                checked={ticks[i]}
                onChange={(e) => setTicks((t) => t.map((v, n) => (n === i ? e.target.checked : v)))}
                className="mt-0.5 h-4 w-4 flex-none accent-[#d97706]"
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          <button className={BTN} disabled={!all} onClick={() => go("readiness")}>Continue</button>
          <button className={BTN_GHOST} onClick={() => go("invite")}>Not right now</button>
        </div>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">
        Continue is disabled until all four are ticked — honest, itemized consent (DPDP), naming the recording.
      </p>
    </>
  );
}

/* --------------------------------------------------------- 3 readiness */

type CheckState = "run" | "pass" | "warn" | "fail";
type Checks = Record<string, { state: CheckState; note: string }>;

function Readiness({ go }: { go: (s: Step) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [checks, setChecks] = useState<Checks>({
    cam: { state: "run", note: "checking…" },
    mic: { state: "run", note: "checking…" },
    spd: { state: "run", note: "checking…" },
    brw: { state: "run", note: "checking…" },
    pip: { state: "run", note: "checking…" },
    scr: { state: "run", note: "checking…" },
    por: { state: "run", note: "checking…" },
  });
  const set = (k: string, state: CheckState, note: string) =>
    setChecks((c) => ({ ...c, [k]: { state, note } }));

  useEffect(() => {
    let raf = 0;
    let audioCtx: AudioContext | null = null;

    // Browser / PiP / screen — synchronous feature detection.
    const pip = typeof window !== "undefined" && "documentPictureInPicture" in window;
    set("pip", pip ? "pass" : "warn", pip ? "Yes" : "Docked mode");
    const chromium = typeof navigator !== "undefined" && /Chrome|Edg/.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent);
    set("brw", chromium ? "pass" : "warn", chromium ? "Supported" : "Use Chrome/Edge desktop");
    const bigEnough = typeof window !== "undefined" && window.innerWidth >= 1000;
    set("scr", bigEnough ? "pass" : "warn", bigEnough ? "OK" : "Small screen");

    // Camera + mic — real getUserMedia (needs permission; graceful on deny).
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        set("cam", "pass", "Detected");
        // mic level meter via AudioContext analyser
        const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        audioCtx = new AC();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let sawSound = false;
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setMicLevel(Math.min(100, avg * 1.6));
          if (avg > 8 && !sawSound) { sawSound = true; set("mic", "pass", "Working"); }
          raf = requestAnimationFrame(tick);
        };
        tick();
        // if no sound within 3s, still pass (mic present) but hint
        setTimeout(() => { if (!sawSound) set("mic", "pass", "Ready"); }, 3000);
      } catch {
        set("cam", "fail", "Allow camera access");
        set("mic", "fail", "Allow mic access");
      }
    })();

    // Bandwidth probe — time a real same-origin asset fetch.
    (async () => {
      try {
        const t0 = performance.now();
        const res = await fetch(`/og/enterprise-og.png?cb=${Date.now()}`, { cache: "no-store" });
        const buf = await res.arrayBuffer();
        const secs = (performance.now() - t0) / 1000;
        const mbps = (buf.byteLength * 8) / secs / 1e6;
        if (mbps >= 4) set("spd", "pass", `${mbps.toFixed(0)} Mbps`);
        else if (mbps >= 1) set("spd", "warn", `${mbps.toFixed(1)} Mbps — snapshots only`);
        else set("spd", "warn", "Slow — try a better connection");
      } catch {
        set("spd", "warn", "Could not measure");
      }
    })();

    // Azure Portal reachability — opaque no-cors ping with timeout.
    (async () => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 4000);
      try {
        await fetch("https://portal.azure.com/favicon.ico", { mode: "no-cors", signal: ctrl.signal, cache: "no-store" });
        set("por", "pass", "Reachable");
      } catch {
        set("por", "warn", "Blocked? try another network");
      } finally {
        clearTimeout(to);
      }
    })();

    return () => {
      cancelAnimationFrame(raf);
      audioCtx?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: [string, string][] = [
    ["cam", "Camera detected & framed"],
    ["mic", "Microphone working"],
    ["spd", "Internet speed"],
    ["brw", "Browser supported (Chrome/Edge)"],
    ["pip", "Floating window supported"],
    ["scr", "Screen size OK"],
    ["por", "Cloud console reachable"],
  ];
  const blocking = ["cam", "mic"].some((k) => checks[k].state === "fail");
  const stillRunning = rows.some(([k]) => checks[k].state === "run");

  return (
    <>
      <Device title="Readiness check">
        <Eyebrow>60-second setup test</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">Let&apos;s check your camera, mic &amp; connection</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          Just like a proctored exam — we test everything now so nothing surprises you once the clock
          starts. Run it any time before your slot.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-900">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-[14%_26%] rounded-[50%] border-2 border-dashed border-white/50" />
              <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Camera preview
              </div>
              {checks.cam.state === "fail" && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 px-6 text-center text-xs text-slate-300">
                  Allow camera &amp; microphone access when your browser asks.
                </div>
              )}
            </div>
            <div className="mt-3 rounded-xl border border-line bg-surface p-4">
              <p className="text-[13px] font-bold text-ink">Microphone <span className="font-normal text-muted">— say something</span></p>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-gradient-to-r from-green-600 to-green-400 transition-[width] duration-100" style={{ width: `${micLevel}%` }} />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            {rows.map(([k, label]) => {
              const c = checks[k];
              const color = c.state === "pass" ? "text-green-600" : c.state === "fail" ? "text-red-600" : c.state === "warn" ? "text-amber-700" : "text-muted";
              return (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-[13.5px] last:border-b-0">
                  <span className="text-ink-soft">{label}</span>
                  <span className={`text-[12px] font-bold ${color}`}>
                    {c.state === "run" ? "checking…" : c.note}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button className={BTN} disabled={stillRunning || blocking} onClick={() => go("otp")}>
            {blocking ? "Fix camera/mic to continue" : "All good — continue →"}
          </button>
          {!stillRunning && !blocking && <span className="text-xs text-green-700">✓ You&apos;re ready</span>}
        </div>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">
        Zero install (OnVUE needs a download; this is pure browser). Real camera, real mic meter, real speed &amp; feature checks.
        Only camera/mic are hard blocks; the rest warn.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- 4 otp */

function Otp({ go }: { go: (s: Step) => void }) {
  const [vals, setVals] = useState(["", "", "", "", "", ""]);
  return (
    <>
      <Device title="Verify it's you">
        <div className="text-center">
          <Eyebrow>Check your email</Eyebrow>
          <h1 className="mt-1.5 text-xl font-bold text-ink">Enter your 6-digit code</h1>
          <p className="mx-auto mt-3 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">
            We sent a code to <b>priya@examplemail.com</b>. It expires in 10 minutes.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {vals.map((v, i) => (
              <input
                key={i}
                value={v}
                inputMode="numeric"
                maxLength={1}
                onChange={(e) => {
                  const d = e.target.value.replace(/\D/g, "").slice(0, 1);
                  setVals((a) => a.map((x, n) => (n === i ? d : x)));
                  if (d && e.target.nextElementSibling) (e.target.nextElementSibling as HTMLInputElement).focus();
                }}
                className="h-13 w-11 rounded-lg border border-line-strong bg-canvas py-3 text-center text-xl font-bold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            ))}
          </div>
          <div className="mt-6"><button className={BTN} onClick={() => go("prebrief")}>Verify →</button></div>
          <p className="mt-4 text-xs text-muted">
            No document or face-upload for identity — just email. Identity is confirmed by the recruiter from the recording later.
          </p>
        </div>
      </Device>
    </>
  );
}

/* --------------------------------------------------------- 5 prebrief */

function PreBrief({ go }: { go: (s: Step) => void }) {
  const cards = [
    ["🖥️ Your environment", "Your own private Azure environment — the real Azure Portal, isolated. Nothing touches any real company system."],
    ["⏱️ 60 minutes", "Can't be paused. Always visible in a small floating window that stays on top of the Azure Portal."],
    ["✅ Up to 5 tasks", "Partial credit is real — 3 of 5 done well beats 0 of 5. You never see a score."],
    ["🤝 The rules", "AI & docs allowed. Work alone. Session is recorded (camera + mic)."],
  ];
  return (
    <>
      <Device title="What to expect">
        <Eyebrow>Read this once — 1 minute</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">How the assessment works</h1>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-bold text-ink">{t}</p>
              <p className="mt-1.5 text-[13px] text-muted">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-[12.5px] leading-relaxed text-blue-900">
          <span>ℹ️</span>
          <span>
            <b>How the two windows work:</b> when you press Start, the <b>Azure Portal opens in a new tab</b>,
            and a small <b>floating companion</b> (your timer, tasks, and Submit) appears on top of it. This
            page goes quiet — you&apos;ll only ever use those two.
          </span>
        </div>
        <div className="mt-5"><button className={BTN} onClick={() => go("booking")}>Got it — book my slot →</button></div>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">Rehearses the tab↔companion handoff before the timer — the #1 confusion point.</p>
    </>
  );
}

/* --------------------------------------------------------- 6 booking */

const SLOTS = [
  ["Today", "4:00 PM"], ["Today", "6:30 PM"], ["Tomorrow", "10:00 AM"], ["Tomorrow", "2:00 PM"],
  ["Thu", "11:00 AM"], ["Thu", "5:00 PM"], ["Fri", "9:30 AM"], ["Fri", "3:00 PM"],
];

function Booking({ go }: { go: (s: Step) => void }) {
  const [sel, setSel] = useState<number | null>(null);
  return (
    <>
      <Device title="Pick a time">
        <Eyebrow>Times shown in your timezone · IST</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">When would you like to take it?</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          Block about 75 minutes total (setup + 60-min assessment). Or start right now.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SLOTS.map(([d, t], i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              className={`rounded-lg border px-2 py-2.5 text-center text-[12.5px] font-semibold transition-colors ${
                sel === i ? "border-brand bg-brand text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand"
              }`}
            >
              {d}<span className="block text-[10px] font-normal opacity-80">{t}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className={BTN_GHOST} disabled={sel === null} onClick={() => go("lobby")}>Confirm slot</button>
          <button className={BTN} onClick={() => go("lobby")}>⚡ Start now</button>
        </div>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">
        &ldquo;Start now&rdquo; is gated by live capacity. A confirmed slot pre-provisions the environment ahead of time. <span className="font-mono">{/* TODO(engine): slot capacity + warm pool */}</span>
      </p>
    </>
  );
}

/* ---------------------------------------------------------- 7 lobby */

function Lobby({ go }: { go: (s: Step) => void }) {
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("Creating your resource group…");
  const [ready, setReady] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    // TODO(engine): replace with real Azure provisioning poll + health gate.
    const steps = ["Creating your resource group…", "Deploying the scenario…", "Applying your access…", "Final checks…"];
    const t = setInterval(() => {
      setPct((p) => {
        const n = Math.min(100, p + 8 + Math.random() * 10);
        setMsg(steps[Math.min(steps.length - 1, Math.floor(n / 26))]);
        if (n >= 100) { clearInterval(t); setReady(true); }
        return n;
      });
    }, 420);
    return () => clearInterval(t);
  }, []);
  return (
    <Device title="Preparing…">
      <div className="text-center">
        <Eyebrow>Almost there</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">{ready ? "Your environment is ready" : "Building your private cloud environment"}</h1>
        {!ready && <p className="mx-auto mt-3 max-w-[46ch] text-[15px] text-ink-soft">{msg}</p>}
        <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-gradient-to-r from-brand to-amber-400 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        {ready && (
          <div className="mt-5">
            <span className="rounded-full bg-green-50 px-3.5 py-1.5 text-[13px] font-bold text-green-700">✓ Environment ready</span>
            <p className="mx-auto mt-3.5 max-w-[46ch] text-[15px] text-ink-soft">
              The moment you press Start, the timer begins and can&apos;t be paused.
            </p>
            <div className="mt-4"><button className={BTN} onClick={() => setConfirm(true)}>Start assessment →</button></div>
          </div>
        )}
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-5" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold text-ink">Ready to start?</h2>
            <p className="mt-2 text-sm text-muted">
              The 60-minute timer begins immediately and can&apos;t be paused. Your Azure Portal opens in a new tab and the floating companion appears.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button className={BTN} onClick={() => go("room")}>Yes, start now</button>
              <button className={BTN_GHOST} onClick={() => setConfirm(false)}>Wait</button>
            </div>
          </div>
        </div>
      )}
    </Device>
  );
}

/* ----------------------------------------------------------- 8 room */

function Room({ go }: { go: (s: Step) => void }) {
  const [secs, setSecs] = useState(59 * 60 + 41);
  const [done, setDone] = useState<boolean[]>(OBJECTIVES.map(() => false));
  const [tested, setTested] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);
  const companionRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");

  // Real Document Picture-in-Picture pop-out (progressive enhancement).
  const popOut = useCallback(async () => {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } }).documentPictureInPicture;
    if (!dpip || !companionRef.current) return;
    try {
      const w = await dpip.requestWindow({ width: 300, height: 460 });
      // copy styles into the PiP document so Tailwind classes render
      document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        w.document.head.appendChild(node.cloneNode(true));
      });
      w.document.body.style.margin = "0";
      w.document.body.appendChild(companionRef.current);
      setPip(w);
      w.addEventListener("pagehide", () => {
        if (holderRef.current && companionRef.current) holderRef.current.appendChild(companionRef.current);
        setPip(null);
      });
    } catch {
      /* stays docked */
    }
  }, []);

  const companion = (
    <div ref={companionRef} className="w-[300px] overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_22px_50px_-14px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between bg-ink px-3 py-2 text-[11px] font-semibold text-slate-200">
        <span>ShieldSync · assessment</span>
        {!pip && (
          <button onClick={popOut} className="rounded bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-600">Pop out ↗</button>
        )}
      </div>
      <div className="px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <b className="font-mono text-[22px] text-ink">{mm}:{ss}</b>
          <span className="text-[10px] uppercase tracking-wide text-muted">remaining</span>
        </div>
        <ol className="mt-2.5 space-y-1.5">
          {OBJECTIVES.map((o, i) => (
            <li
              key={i}
              onClick={() => setDone((d) => d.map((v, n) => (n === i ? !v : v)))}
              className={`flex cursor-pointer items-baseline gap-2 text-[12px] ${done[i] ? "text-muted line-through" : "text-ink-soft"}`}
            >
              <span className={`mt-0.5 flex h-3.5 w-3.5 flex-none items-center justify-center rounded border text-[9px] ${done[i] ? "border-green-600 bg-green-600 text-white" : "border-line-strong text-muted"}`}>
                {done[i] ? "✓" : i + 1}
              </span>
              {o}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex gap-1.5">
          <button onClick={() => setTested(true)} className="flex-1 rounded-full border border-brand/40 bg-surface px-2 py-1.5 text-[11.5px] font-semibold text-brand-strong hover:bg-brand hover:text-white">🧪 Test the app</button>
          <button onClick={() => setConfirm(true)} className="flex-1 rounded-full bg-brand px-2 py-1.5 text-[11.5px] font-semibold text-white hover:bg-brand-strong">Submit</button>
        </div>
        {tested && (
          <p className="mt-2 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-[11.5px] text-green-700">✓ Pipeline ran — the app still works.</p>
        )}
        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5">
          <span className="flex h-8 w-11 flex-none items-center justify-center rounded bg-slate-900 text-[9px] text-slate-500">cam</span>
          <div className="text-[10.5px] leading-tight text-ink-soft">
            <div className="flex items-center gap-1 font-bold text-red-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> Recording</div>
            <div>Snapshots · 🎙 Mic on</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full bg-brand-soft px-2.5 py-1 font-bold text-brand-strong">Two windows</span>
        The real product opens Azure in a separate tab; the companion floats on top of it. Here both are shown together.
        Try <b>Pop out ↗</b> in the companion for the real floating window.
      </p>
      <div className="overflow-hidden rounded-2xl border border-line bg-[#f3f4f6]">
        {/* faux azure portal */}
        <div className="flex items-center gap-3 bg-[#1f1f1f] px-3.5 py-2 text-[12px] text-white">
          <span className="font-semibold">▦ Microsoft Azure</span>
          <span className="ml-2 hidden max-w-[360px] flex-1 rounded bg-[#2d2d2d] px-2.5 py-1 text-[11px] text-slate-400 sm:block">Search resources, services, and docs</span>
          <span className="ml-auto rounded bg-[#0e5a9c] px-2 py-0.5 text-[11px]">🔒 assessment-rg · Priya S.</span>
        </div>
        <div className="relative flex min-h-[440px]">
          <div className="hidden w-44 flex-none border-r border-[#e5e7eb] bg-[#f9fafb] px-2 py-3 text-[12px] text-[#374151] sm:block">
            <div className="mx-1.5 mb-1 mt-2.5 text-[10px] uppercase tracking-wide text-[#6b7280]">Storage</div>
            <div className="rounded bg-[#e5effb] px-2 py-1.5 font-semibold text-[#0078d4]">Storage accounts</div>
            <div className="px-2 py-1.5">Containers</div>
            <div className="mx-1.5 mb-1 mt-2.5 text-[10px] uppercase tracking-wide text-[#6b7280]">Identity</div>
            <div className="px-2 py-1.5">Microsoft Entra ID</div>
            <div className="px-2 py-1.5">Access control (IAM)</div>
            <div className="mx-1.5 mb-1 mt-2.5 text-[10px] uppercase tracking-wide text-[#6b7280]">Security</div>
            <div className="px-2 py-1.5">Key vaults</div>
            <div className="px-2 py-1.5">Defender for Cloud</div>
            <div className="px-2 py-1.5">Activity log</div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <p className="text-[12px] text-[#0078d4]">Home &gt; Storage accounts</p>
            <p className="my-2 text-[17px] font-semibold text-[#1f2937]">Storage accounts</p>
            <table className="w-full border-collapse overflow-hidden rounded-lg border border-[#e5e7eb] bg-white text-[12.5px]">
              <thead>
                <tr className="bg-[#fafafa] text-[11px] text-[#6b7280]">
                  <th className="border-b border-[#eee] px-2.5 py-2 text-left font-semibold">Name</th>
                  <th className="border-b border-[#eee] px-2.5 py-2 text-left font-semibold">Public access</th>
                  <th className="border-b border-[#eee] px-2.5 py-2 text-left font-semibold">Secure transfer</th>
                </tr>
              </thead>
              <tbody className="text-[#1f2937]">
                <tr><td className="border-b border-[#f3f4f6] px-2.5 py-2 font-mono">stpipelinedata7f2a</td><td className="border-b border-[#f3f4f6] px-2.5 py-2"><span className="rounded-full bg-[#fdecea] px-1.5 py-0.5 text-[10.5px] font-bold text-[#c0392b]">Enabled ⚠</span></td><td className="border-b border-[#f3f4f6] px-2.5 py-2">Disabled</td></tr>
                <tr><td className="border-b border-[#f3f4f6] px-2.5 py-2 font-mono">stpipelineassets</td><td className="border-b border-[#f3f4f6] px-2.5 py-2"><span className="rounded-full bg-[#eafaf1] px-1.5 py-0.5 text-[10.5px] font-bold text-[#1e8e4f]">Disabled</span></td><td className="border-b border-[#f3f4f6] px-2.5 py-2">Enabled</td></tr>
                <tr><td className="px-2.5 py-2 font-mono">stpipelinelogs</td><td className="px-2.5 py-2"><span className="rounded-full bg-[#eafaf1] px-1.5 py-0.5 text-[10.5px] font-bold text-[#1e8e4f]">Disabled</span></td><td className="px-2.5 py-2">Enabled</td></tr>
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">A realistic Azure Portal — the candidate actually fixes these. (Preview: this table is illustrative.)</p>
          </div>
          {/* docked companion holder (or empty when popped out) */}
          <div ref={holderRef} className="absolute bottom-4 right-4">
            {!pip && companion}
          </div>
        </div>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/55 p-5" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[17px] font-bold text-ink">Submit your assessment?</h2>
            <p className="mt-2 text-sm text-muted">You have <b>{mm}:{ss}</b> left. You can keep working, or submit now — your work is graded either way.</p>
            <div className="mt-4 flex gap-2.5">
              <button className={BTN} onClick={() => go("reflection")}>Submit now</button>
              <button className={BTN_GHOST} onClick={() => setConfirm(false)}>Keep working</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------- 9 reflection */

function Reflection({ go }: { go: (s: Step) => void }) {
  return (
    <>
      <Device title="2 quick questions · not scored">
        <Eyebrow>While it&apos;s fresh</Eyebrow>
        <h1 className="mt-1.5 text-xl font-bold text-ink">Tell us how you approached it</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
          Optional, ~1 minute. These don&apos;t change your score — the employer reads them as-is.
          (This is what proves <i>you</i> did the work, without a follow-up call weeks later.)
        </p>
        <div className="mt-4 rounded-xl border border-line bg-surface p-4">
          <label className="text-xs text-muted">In one line — what did you fix first, and why?</label>
          <textarea rows={2} className="mt-1.5 w-full rounded-lg border border-line p-2 text-[13px]" placeholder="The public storage account — it was the only internet-reachable exposure…" />
          <label className="mt-3 block text-xs text-muted">One thing you&apos;d still improve with more time?</label>
          <textarea rows={2} className="mt-1.5 w-full rounded-lg border border-line p-2 text-[13px]" placeholder="Rotate the storage keys and move fully to managed identity…" />
        </div>
        <div className="mt-5 flex gap-3">
          <button className={BTN} onClick={() => go("done")}>Submit &amp; finish →</button>
          <button className={BTN_GHOST} onClick={() => go("done")}>Skip</button>
        </div>
      </Device>
    </>
  );
}

/* ---------------------------------------------------------- 10 done */

function Done({ go }: { go: (s: Step) => void }) {
  return (
    <>
      <Device title="Submitted">
        <div className="text-center">
          <div className="mx-auto mt-2 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 text-3xl text-green-600">✓</div>
          <h1 className="mt-3.5 text-xl font-bold text-ink">You&apos;re all done, Priya</h1>
          <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
            Your work has been submitted to Acme Corp&apos;s hiring team. You completed <b>4 of 5 tasks</b> and
            your app kept running throughout. Thanks for your time.
          </p>
          <p className="mt-4 text-xs text-muted">You won&apos;t see a score — that&apos;s by design. Acme&apos;s team reviews your verified results and will be in touch.</p>
          <div className="mt-4"><button className={BTN_GHOST} onClick={() => go("invite")}>↺ Replay the journey</button></div>
        </div>
      </Device>
      <p className="mt-4 text-center text-xs text-muted">That&apos;s the full candidate journey — magic link to done.</p>
    </>
  );
}
