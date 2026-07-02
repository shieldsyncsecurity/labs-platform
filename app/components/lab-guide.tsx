"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/context";
import { useLabWorkspace } from "@/components/lab-workspace";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Track = "console" | "cli";
type Segment = { kind: "common" | "refcard" | Track; text: string };

/**
 * Split the walkthrough into common prose + per-track (Console / CLI) blocks so the
 * learner can pick ONE style instead of wading through both stacked inline.
 * A track block runs from its 🖱️/⌨️ marker line until the next marker, the next
 * heading ("## …"), or a "---" rule. A ":::refcard … :::" fence becomes a distinct
 * reference card. Fenced code is respected so a "#" or emoji inside a ``` block is
 * never treated as a delimiter.
 */
function splitTracks(md: string): Segment[] {
  const lines = md.split("\n");
  const segs: Segment[] = [];
  let cur: Segment = { kind: "common", text: "" };
  let inFence = false;
  let inRefcard = false;
  const push = () => {
    const text = cur.text.replace(/\n+$/, "");
    if (text.trim()) segs.push({ kind: cur.kind, text });
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
      // ":::refcard" opens a reference-card block; the next ":::" closes it. The
      // fence markers themselves are dropped from the rendered text.
      if (!inRefcard && /^:::refcard\s*$/.test(line)) {
        push();
        cur = { kind: "refcard", text: "" };
        inRefcard = true;
        continue;
      }
      if (inRefcard) {
        if (/^:::\s*$/.test(line)) {
          push();
          cur = { kind: "common", text: "" };
          inRefcard = false;
          continue;
        }
        cur.text += line + "\n";
        continue;
      }
      const isConsole = /^🖱️/.test(line);
      const isCli = /^⌨️/.test(line);
      const isBreak = /^#{1,6}\s/.test(line) || /^---\s*$/.test(line);
      if (isConsole || isCli) {
        push();
        cur = { kind: isConsole ? "console" : "cli", text: line + "\n" };
        continue;
      }
      if (isBreak && cur.kind !== "common") {
        push();
        cur = { kind: "common", text: line + "\n" };
        continue;
      }
    }
    cur.text += line + "\n";
  }
  push();
  return segs;
}

/**
 * Rewrite two lightweight authoring conventions (used inside 🖱️ Console blocks)
 * into inline `code` tokens that `mdComponents` renders as rich UI:
 *   - a line starting with ">>"  → a breadcrumb nav-path (segments split on "›")
 *   - "[[Label]]"                → a button-like click-target chip
 * Leading indentation on a ">>" line is PRESERVED so the token stays inside its
 * markdown list item. Non-matches degrade to plain text — never crash.
 */
function chipify(md: string): string {
  return md
    .replace(/^([ \t]*)>>[ \t]*(.+?)\s*$/gm, (_m, indent, p) => `${indent}\`navpath:${p}\``)
    .replace(/\[\[([^\]]+)\]\]/g, (_m, p) => `\`chip:${p.trim()}\``);
}

// Custom react-markdown renderers. The only override is `code`: tokens produced by
// chipify ("navpath:" / "chip:") become breadcrumbs / chips; everything else (block
// code, ordinary inline code) renders unchanged. react-markdown v9 dropped the
// `inline` prop, so we detect inline = no language class + single line.
const mdComponents: Components = {
  code({ node, className, children, ...props }) {
    void node; // drop the AST node so it isn't spread onto the DOM element
    const txt = String(children);
    const isInline = !/language-/.test(className ?? "") && !txt.includes("\n");
    if (isInline && txt.startsWith("navpath:")) {
      const parts = txt.slice("navpath:".length).split("›").map((s) => s.trim()).filter(Boolean);
      return (
        <span className="ss-navpath" role="img" aria-label={`Console path: ${parts.join(" then ")}`}>
          {parts.map((p, i) => (
            <span key={i} className="ss-navseg-wrap">
              <span className={`ss-navseg${i === 0 ? " ss-navseg-root" : ""}`}>{p}</span>
              {i < parts.length - 1 && (
                <span className="ss-navsep" aria-hidden>›</span>
              )}
            </span>
          ))}
        </span>
      );
    }
    if (isInline && txt.startsWith("chip:")) {
      return <span className="ss-uichip">{txt.slice("chip:".length)}</span>;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// Split the source into the always-visible OVERVIEW and the launch-gated WALKTHROUGH.
// Prefer an explicit "<!-- ss:walkthrough -->" sentinel; else fall back to the first
// "## Step" heading; else everything is overview (no gating) so no lab can hide all
// of its content by accident.
function splitGuide(md: string): { overview: string; walkthrough: string } {
  const sentinel = md.match(/<!--\s*ss:walkthrough\s*-->/);
  if (sentinel && sentinel.index != null) {
    return { overview: md.slice(0, sentinel.index), walkthrough: md.slice(sentinel.index + sentinel[0].length) };
  }
  const step = md.search(/^##\s+Step\b/m);
  if (step >= 0) return { overview: md.slice(0, step), walkthrough: md.slice(step) };
  return { overview: md, walkthrough: "" };
}

// The exact step-heading pattern used everywhere (app/labs/[slug]/page.tsx's
// extractStepTitles uses the same shape) — keep in sync.
const STEP_HEADING_RE = /^##\s+Step\s+\d+\s*[—–-]\s*(.+?)\s*$/gm;

/**
 * Break the raw walkthrough markdown into per-step chunks, one per "## Step N —
 * Title" heading (heading line included, so downstream rendering — refcards, track
 * blocks — still sees it). Any content BEFORE the first heading is NOT included
 * here; the caller (LabGuide) surfaces it separately via `leadInOf` and folds it
 * into the Overview segment. If there are no step headings at all, the whole
 * markdown is returned as a single untitled chunk (defensive fallback).
 */
function splitWalkthroughIntoSteps(md: string): { title: string; body: string }[] {
  const re = /^##\s+Step\s+\d+\s*[—–-]\s*(.+?)\s*$/gm;
  const matches: { index: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) matches.push({ index: m.index, title: m[1].trim() });

  if (matches.length === 0) {
    return md.trim() ? [{ title: "", body: md }] : [];
  }

  const out: { title: string; body: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    out.push({ title: matches[i].title, body: md.slice(start, end) });
  }
  return out;
}

function leadInOf(md: string): string {
  const idx = md.search(STEP_HEADING_RE);
  STEP_HEADING_RE.lastIndex = 0;
  return idx >= 0 ? md.slice(0, idx) : md;
}

// Sticky so it's always reachable while scrolling the steps. The caption swaps with
// the track, so flipping it is visibly confirmed even before you look at the steps.
function TrackToggle({ track, onPick }: { track: Track; onPick: (t: Track) => void }) {
  const seg = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
      active ? "bg-brand text-white shadow-sm" : "text-ink-soft hover:bg-surface"
    }`;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas p-1.5" role="tablist" aria-label="Instruction style">
      <button role="tab" aria-selected={track === "console"} onClick={() => onPick("console")} className={seg(track === "console")}>
        🖱️ Console
      </button>
      <button role="tab" aria-selected={track === "cli"} onClick={() => onPick("cli")} className={seg(track === "cli")}>
        ⌨️ CLI
      </button>
      <span className="ml-auto pr-1 text-xs font-medium text-muted">
        {track === "console" ? "Point-and-click in the AWS web UI" : "Commands in CloudShell ( >_ top bar )"}
      </span>
    </div>
  );
}

// Renders one segment list (refcards + common/track prose) the same way the guide
// always has — reused per-step now instead of once for the whole walkthrough.
function renderSegments(md: string): { refcardNodes: ReactNode[]; bodyNodes: ReactNode[]; hasTracks: boolean } {
  const segs = splitTracks(md);
  const refcardNodes: ReactNode[] = [];
  const bodyNodes: ReactNode[] = [];
  segs.forEach((s, i) => {
    if (s.kind === "refcard") {
      refcardNodes.push(
        <aside key={`rc-${i}`} className="ss-refcard">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{s.text}</ReactMarkdown>
        </aside>
      );
      return;
    }
    // chipify runs on common + console; NOT cli (bash legitimately uses ">>").
    const src = s.kind === "cli" ? s.text : chipify(s.text);
    bodyNodes.push(
      s.kind === "common" ? (
        <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>{src}</ReactMarkdown>
      ) : (
        <div key={i} className={`ss-track ss-track-${s.kind}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{src}</ReactMarkdown>
        </div>
      )
    );
  });
  return { refcardNodes, bodyNodes, hasTracks: segs.some((s) => s.kind === "console" || s.kind === "cli") };
}

// Shown in place of the walkthrough until the learner launches the lab. Left-aligned
// to sit flush with the guide above, and it previews the actual locked steps so the
// learner sees exactly what they'll unlock (a teaser, not an empty placeholder).
function LaunchGate({ steps }: { steps: string[] }) {
  return (
    <div className="not-prose mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base">🔒</span>
          <p className="text-base font-extrabold text-ink">Your step-by-step walkthrough</p>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          Hit <strong>Launch lab</strong> on the right — your own isolated AWS account spins up and the full
          guide opens right here, with 🖱️ Console and ⌨️ CLI for every fix.
        </p>
      </div>
      {steps.length > 0 && (
        <ol className="divide-y divide-line">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-2.5">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-canvas text-xs font-bold text-muted ring-1 ring-line">
                {i + 1}
              </span>
              <span className="text-sm text-ink-soft">{s}</span>
            </li>
          ))}
          <li className="flex items-center gap-3 px-5 py-2.5">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-canvas text-xs text-muted ring-1 ring-line" aria-hidden>✓</span>
            <span className="text-sm text-muted">Check my work — auto-graded against your live account</span>
          </li>
        </ol>
      )}
    </div>
  );
}

// Scrolls to (and focuses, if focusable) the "Check my work" area once launched: the
// right-rail objectives card on desktop, or the sticky mobile action bar on phones.
// Both ids are rendered by LabPanel; falls back to a no-op if neither is present yet
// (e.g. auto-grading hasn't produced objectives for this lab).
function goToCheckWork() {
  if (typeof document === "undefined") return;
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 1023px)").matches;
  const el = isMobile
    ? document.getElementById("ss-check-work-mobile")
    : document.getElementById("ss-check-work") ?? document.getElementById("ss-check-work-mobile");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof (el as HTMLElement).focus === "function") {
    try {
      (el as HTMLElement).focus({ preventScroll: true });
    } catch {}
  }
}

const btnNext =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-brand to-cyan px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand/20 transition hover:brightness-110 disabled:opacity-50";
const btnBack =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-strong px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50";

/**
 * Sticky player header: step dropdown (jump to any step, shows done/current state),
 * the Console/CLI toggle, and "Step N of M". Sits above a thin progress bar.
 */
function GuideHeader({
  step,
  total,
  titles,
  onJump,
  hasTracks,
  track,
  onPickTrack,
}: {
  step: number; // 0 = Overview
  total: number; // total steps, NOT counting Overview
  titles: string[];
  onJump: (i: number) => void;
  hasTracks: boolean;
  track: Track;
  onPickTrack: (t: Track) => void;
}) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  return (
    <div className="ss-guide-header sticky top-2 z-20 -mx-6 -mt-6 mb-6 rounded-t-2xl border-b border-line bg-surface/95 px-6 pt-5 pb-3 backdrop-blur sm:-mx-7 sm:-mt-7 sm:px-7">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="sr-only">Jump to step</span>
          <select
            value={step}
            onChange={(e) => onJump(Number(e.target.value))}
            className="w-full min-w-0 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm font-semibold text-ink outline-none focus:border-brand sm:w-auto"
          >
            <option value={0}>{step === 0 ? "▸ " : ""}Overview</option>
            {titles.map((t, i) => (
              <option key={i} value={i + 1}>
                {i + 1 < step ? "✓ " : i + 1 === step ? "▸ " : ""}Step {i + 1} — {t}
              </option>
            ))}
          </select>
        </label>

        {hasTracks && step > 0 && (
          <div className="order-3 w-full sm:order-none sm:w-auto">
            <TrackToggle track={track} onPick={onPickTrack} />
          </div>
        )}

        <span className="flex-none font-mono text-xs font-bold text-muted">
          {step === 0 ? `Overview` : `Step ${step} of ${total}`}
        </span>
      </div>

      <div className="ss-bar-track mt-3" aria-hidden>
        <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function LabGuide({
  slug,
  instructions,
  gatedSlug,
  stepTitles: stepTitlesProp,
}: {
  slug: string;
  instructions: string;
  /** Paid lab: the walkthrough is NOT in `instructions` — fetch it from the gated route. */
  gatedSlug?: string;
  /** Server-provided step headings for the launch-gate preview (works even when gated). */
  stepTitles?: string[];
}) {
  const { user, hasAccess, loading } = useAuth();
  const { launched } = useLabWorkspace();
  const [track, setTrack] = useState<Track>("console"); // default to point-and-click (beginner-friendly)
  const [remoteWt, setRemoteWt] = useState<string | null>(null); // gated walkthrough, once fetched
  const [stepIndex, setStepIndex] = useState(0); // 0 = Overview, 1..M = steps
  const articleRef = useRef<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem("ss-lab-track");
      if (t === "cli" || t === "console") setTrack(t);
    } catch {}
  }, []);
  const pick = (t: Track) => {
    setTrack(t);
    try { localStorage.setItem("ss-lab-track", t); } catch {}
  };

  // Paid labs: the walkthrough (answers + capture flag) is never shipped in the page
  // payload. Fetch it from the entitlement-checked route once launched — launch already
  // requires entitlement, and the route re-checks server-side.
  useEffect(() => {
    if (!gatedSlug || !launched || remoteWt !== null) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/lab-content?slug=${encodeURIComponent(gatedSlug)}`, { cache: "no-store" });
        const d = r.ok ? await r.json().catch(() => ({})) : {};
        if (alive) setRemoteWt(typeof d.walkthrough === "string" ? d.walkthrough : "");
      } catch {
        if (alive) setRemoteWt("");
      }
    })();
    return () => { alive = false; };
  }, [gatedSlug, launched, remoteWt]);

  // Overview is always local (parsed once). The walkthrough is local for free labs,
  // fetched for paid. `wtSource === null` means "gated, not fetched yet".
  const { overviewMd, localWalkthrough } = useMemo(() => {
    const { overview, walkthrough } = splitGuide(instructions);
    return { overviewMd: overview, localWalkthrough: walkthrough };
  }, [instructions]);

  const wtSource = gatedSlug ? remoteWt : localWalkthrough;
  const hasWalkthrough = gatedSlug ? true : localWalkthrough.trim().length > 0;

  // Break whatever walkthrough markdown we currently have into per-step chunks.
  // Any content before "## Step 1" (refcards, orientation prose) is folded into the
  // Overview segment so nothing from the source is lost.
  const { stepChunks, walkthroughLeadIn } = useMemo(() => {
    const src = wtSource ?? "";
    return { stepChunks: splitWalkthroughIntoSteps(src), walkthroughLeadIn: leadInOf(src) };
  }, [wtSource]);

  // Overview segment = the always-visible overview markdown + any walkthrough lead-in
  // (refcards etc. that appear before Step 1).
  const overviewRendered = useMemo(() => {
    const overviewNodes = <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{overviewMd}</ReactMarkdown>;
    const leadIn = walkthroughLeadIn.trim() ? renderSegments(walkthroughLeadIn) : null;
    return { overviewNodes, leadIn };
  }, [overviewMd, walkthroughLeadIn]);

  const currentStepRendered = useMemo(() => {
    if (stepIndex === 0) return null;
    const chunk = stepChunks[stepIndex - 1];
    if (!chunk) return null;
    return renderSegments(chunk.body);
  }, [stepChunks, stepIndex]);

  const hasTracksAnywhere = useMemo(
    () => stepChunks.some((c) => splitTracks(c.body).some((s) => s.kind === "console" || s.kind === "cli")),
    [stepChunks]
  );

  // Launch-gate step preview: prefer server-provided titles (so the preview works even
  // when the walkthrough body is gated), else derive from a local walkthrough.
  const stepTitles = useMemo(() => {
    if (stepTitlesProp && stepTitlesProp.length) return stepTitlesProp;
    const out: string[] = [];
    const re = /^##\s+Step\s+\d+\s*[—–-]\s*(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(localWalkthrough)) !== null) out.push(m[1].trim());
    return out;
  }, [stepTitlesProp, localWalkthrough]);

  // Titles for the header dropdown: prefer whatever we actually parsed from the
  // fetched/local walkthrough (accurate once loaded); fall back to the server-provided
  // preview titles while the gated walkthrough hasn't arrived yet, so the dropdown
  // isn't empty during the loading flash.
  const headerTitles = stepChunks.length > 0 ? stepChunks.map((c) => c.title) : stepTitles;
  const totalSteps = headerTitles.length;

  // Persist current step per lab; restore on mount and clamp to range whenever the
  // available step count changes (e.g. once the gated walkthrough finishes loading).
  const storageKey = `ss-guide-step:${slug}`;
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw != null ? parseInt(raw, 10) : 0;
      if (Number.isFinite(n) && n > 0) setStepIndex(n);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (totalSteps > 0 && stepIndex > totalSteps) setStepIndex(totalSteps);
  }, [totalSteps, stepIndex]);

  const goToStep = (i: number) => {
    const clamped = Math.max(0, Math.min(totalSteps, i));
    setStepIndex(clamped);
    try { localStorage.setItem(storageKey, String(clamped)); } catch {}
    // Scroll the guide card into view on step change.
    articleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isLastStep = totalSteps > 0 && stepIndex === totalSteps;

  const onNext = () => {
    if (isLastStep) {
      goToCheckWork();
      return;
    }
    goToStep(stepIndex + 1);
  };
  const onBack = () => goToStep(stepIndex - 1);

  // Optional nice-to-have: ArrowLeft/ArrowRight navigate steps when focus isn't in a
  // text input/select (so typing in a form field is never hijacked).
  useEffect(() => {
    if (totalSteps === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && stepIndex > 0) onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, totalSteps, isLastStep]);

  // Free labs and already-paid users get immediate access.
  // hasAccess() returns true for free labs without needing entitlements.
  if (hasAccess(slug)) {
    return (
      <article ref={articleRef} className="lab-md ss-guide relative rounded-2xl border border-line bg-surface p-6 sm:p-7" data-track={track}>
        {!hasWalkthrough || !launched ? (
          <>
            {overviewRendered.overviewNodes}
            {!hasWalkthrough ? null : <LaunchGate steps={stepTitles} />}
          </>
        ) : wtSource === null ? (
          <>
            {overviewRendered.overviewNodes}
            <p className="mt-6 text-sm text-muted">Loading the walkthrough&hellip;</p>
          </>
        ) : (
          <>
            <GuideHeader
              step={stepIndex}
              total={totalSteps}
              titles={headerTitles}
              onJump={goToStep}
              hasTracks={hasTracksAnywhere}
              track={track}
              onPickTrack={pick}
            />
            <div className="ss-walkthrough">
              {stepIndex === 0 ? (
                <>
                  {overviewRendered.overviewNodes}
                  {overviewRendered.leadIn && (
                    <>
                      {overviewRendered.leadIn.refcardNodes}
                      {overviewRendered.leadIn.bodyNodes}
                    </>
                  )}
                </>
              ) : (
                currentStepRendered && (
                  <>
                    {currentStepRendered.refcardNodes}
                    {currentStepRendered.bodyNodes}
                  </>
                )
              )}
            </div>

            {totalSteps > 0 && (
              <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-5">
                <button type="button" onClick={onBack} disabled={stepIndex === 0} className={btnBack}>
                  ← Back
                </button>
                <span className="font-mono text-xs font-semibold text-muted">
                  {stepIndex === 0 ? "Overview" : `Step ${stepIndex} of ${totalSteps}`}
                </span>
                <button type="button" onClick={onNext} className={btnNext}>
                  {isLastStep ? "Finish — check your work" : "Next →"}
                </button>
              </div>
            )}
          </>
        )}
      </article>
    );
  }

  // Still fetching entitlements — show skeleton so a paid user doesn't see a flash of the lock
  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 sm:p-7">
        <div className="space-y-3">
          <div className="h-4 w-2/3 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-full animate-pulse rounded bg-canvas" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-canvas" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-canvas" />
        </div>
      </div>
    );
  }

  // Locked — blurred preview + overlay
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      {/* blurred teaser — aria-hidden so screen readers skip it */}
      <div
        className="pointer-events-none select-none p-6 sm:p-7"
        style={{ filter: "blur(5px)", opacity: 0.3 }}
        aria-hidden
      >
        <article className="lab-md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{instructions.slice(0, 700)}</ReactMarkdown>
        </article>
      </div>

      {/* lock overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/75 p-8 text-center backdrop-blur-[2px]">
        <span className="text-3xl">🔒</span>
        <p className="mt-3 text-base font-extrabold text-ink">Guide locked</p>
        <p className="mt-1 max-w-xs text-sm text-ink-soft">
          Purchase this lab to unlock the full step-by-step guide and start your session.
        </p>
        {!user ? (
          <Link
            href="/sign-in"
            className="mt-5 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong"
          >
            Sign in to get access
          </Link>
        ) : (
          <p className="mt-4 text-xs text-muted">Use the panel on the right to purchase.</p>
        )}
      </div>
    </div>
  );
}
