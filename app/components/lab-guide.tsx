"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/context";
import { useLabWorkspace } from "@/components/lab-workspace";
import { getLab, nextLab } from "@/lib/labs";
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

// Small clipboard-copy button pinned to the top-right of a terminal code block.
// Always visible (not hover-only) so it's discoverable on touch devices too.
// Swaps to a "Copied" confirmation for 1.5s, then reverts. Best-effort: a failed
// clipboard write (unsupported browser, permissions) just silently no-ops.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ss-copy-btn ${copied ? "ss-copy-btn-active" : ""}`}
      aria-label="Copy code"
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// A dark "terminal" wrapper for fenced code blocks — dark bg, mono text, and a
// copy button. Reads the raw text from the single <code> child so the copy
// button always copies the exact source (not whatever syntax-highlighting nodes
// react-markdown may wrap it in).
function TerminalPre({ children, ...props }: { children?: ReactNode }) {
  const codeText = (() => {
    const child = Array.isArray(children) ? children[0] : children;
    const txt = (child as { props?: { children?: unknown } } | undefined)?.props?.children;
    if (typeof txt === "string") return txt;
    if (Array.isArray(txt)) return txt.join("");
    return "";
  })();
  return (
    <div className="ss-terminal not-prose">
      <CopyButton text={codeText} />
      <pre {...props}>{children}</pre>
    </div>
  );
}

// Custom react-markdown renderers. `code` overrides: tokens produced by chipify
// ("navpath:" / "chip:") become breadcrumbs / chips; everything else (block code,
// ordinary inline code) renders unchanged. react-markdown v9 dropped the `inline`
// prop, so we detect inline = no language class + single line. `pre` wraps fenced
// code blocks in the dark terminal chrome + copy button.
const mdComponents: Components = {
  pre({ children, ...props }) {
    return <TerminalPre {...props}>{children}</TerminalPre>;
  },
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

// Content convention: an HTML comment on the line immediately after a step heading
// maps that step to one or more opaque objective ids (comma-separated), e.g.:
//   ## Step 2 — Shut the public access
//   <!-- ss:obj=block-public-access -->
// Steps without a marker have no grade affordance. Fully product-line-agnostic —
// this file never interprets what an id "means".
const STEP_OBJ_MARKER_RE = /^[ \t]*<!--\s*ss:obj=([^>]+?)\s*-->[ \t]*\n?/m;

/**
 * Break the raw walkthrough markdown into per-step chunks, one per "## Step N —
 * Title" heading (heading line included, so downstream rendering — refcards, track
 * blocks — still sees it). Any content BEFORE the first heading is NOT included
 * here; the caller (LabGuide) surfaces it separately via `leadInOf` and folds it
 * into the Overview segment. If there are no step headings at all, the whole
 * markdown is returned as a single untitled chunk (defensive fallback).
 * Also parses (and strips from `body`) an optional `ss:obj=` marker comment on the
 * line right after the heading — see STEP_OBJ_MARKER_RE.
 */
function splitWalkthroughIntoSteps(md: string): { title: string; body: string; objectiveIds: string[] }[] {
  const re = /^##\s+Step\s+\d+\s*[—–-]\s*(.+?)\s*$/gm;
  const matches: { index: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) matches.push({ index: m.index, title: m[1].trim() });

  const parseChunk = (title: string, raw: string): { title: string; body: string; objectiveIds: string[] } => {
    const headingEnd = raw.indexOf("\n") + 1 || raw.length;
    const rest = raw.slice(headingEnd);
    const marker = rest.match(STEP_OBJ_MARKER_RE);
    if (!marker) return { title, body: raw, objectiveIds: [] };
    const objectiveIds = marker[1].split(",").map((s) => s.trim()).filter(Boolean);
    const body = raw.slice(0, headingEnd) + rest.slice(marker[0].length);
    return { title, body, objectiveIds };
  };

  if (matches.length === 0) {
    return md.trim() ? [parseChunk("", md)] : [];
  }

  const out: { title: string; body: string; objectiveIds: string[] }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    out.push(parseChunk(matches[i].title, md.slice(start, end)));
  }
  return out;
}

function leadInOf(md: string): string {
  const idx = md.search(STEP_HEADING_RE);
  STEP_HEADING_RE.lastIndex = 0;
  return idx >= 0 ? md.slice(0, idx) : md;
}

// Compact segmented control (was a looser toolbar) so it fits neatly in the step
// card's header band next to the step title. The caption moved out — it's implied
// by context now — keeping this small and scannable.
function TrackToggle({ track, onPick }: { track: Track; onPick: (t: Track) => void }) {
  const seg = (active: boolean) =>
    `flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
      active ? "bg-brand text-white shadow-sm" : "text-ink-soft hover:bg-white"
    }`;
  return (
    <div className="flex flex-none items-center gap-0.5 rounded-lg border border-line bg-canvas p-1" role="tablist" aria-label="Instruction style">
      <button role="tab" aria-selected={track === "console"} onClick={() => onPick("console")} className={seg(track === "console")}>
        🖱️ Console
      </button>
      <button role="tab" aria-selected={track === "cli"} onClick={() => onPick("cli")} className={seg(track === "cli")}>
        ⌨️ CLI
      </button>
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
// Verified next-step prompt (#6): same shape as btnNext, green treatment — a step
// whose mapped objectives are ALL "pass".
const btnNextVerified =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-emerald-500/20 transition hover:brightness-110 disabled:opacity-50";
const btnBack =
  "inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-strong px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-canvas disabled:opacity-50";

// Thin brand progress bar — "Step N of M" (or "Overview") + a filled track.
// Shared by the desktop rail (under its divider) and the mobile header band.
// `fixedSummary` (orientation strip, #2): "X of Y fixed" — shown next to the step
// readout, one short segment, only when a session is active and grading data exists.
function StepProgress({ step, total, fixedSummary }: { step: number; total: number; fixedSummary?: string | null }) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  return (
    <div>
      <p className="flex items-center justify-between gap-2 font-mono text-xs font-semibold text-muted">
        <span>{step === 0 ? "Overview" : `Step ${step} of ${total}`}</span>
        {fixedSummary && <span className="text-emerald-700">{fixedSummary}</span>}
      </p>
      <div className="ss-bar-track mt-1.5" aria-hidden>
        <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Desktop (lg+) sticky left rail: Overview + every step, with done/current/upcoming
// states, plus a progress readout under a divider at the bottom. Replaces the old
// select dropdown on wide viewports — jumping uses the same `goTo`/onJump as before.
// `verified` (1-based step numbers whose mapped objectives are ALL "pass") layers a
// distinct emerald treatment on top of done/current — a live-graded confirmation,
// not just "you scrolled past it".
function StepRail({
  step,
  total,
  titles,
  verified,
  fixedSummary,
  onJump,
}: {
  step: number; // 0 = Overview
  total: number;
  titles: string[];
  verified: Set<number>;
  fixedSummary?: string | null;
  onJump: (i: number) => void;
}) {
  const itemClass = (state: "done" | "current" | "upcoming", isVerified: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
      isVerified
        ? "bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-100"
        : state === "current"
        ? "bg-brand/10 font-semibold text-brand"
        : state === "done"
        ? "font-medium text-green-600 hover:bg-canvas"
        : "text-muted hover:bg-canvas hover:text-ink-soft"
    }`;
  return (
    <nav className="hidden lg:sticky lg:top-[4.5rem] lg:block lg:max-h-[var(--ss-workspace-h)] lg:overflow-y-auto lg:overscroll-contain" aria-label="Lab steps">
      <button type="button" onClick={() => onJump(0)} className={itemClass(step === 0 ? "current" : "done", false)}>
        {step === 0 ? (
          <span className="h-4 w-4 flex-none rounded-full border-2 border-brand" aria-hidden />
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-green-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        Overview
      </button>
      <ul className="mt-1 space-y-0.5">
        {titles.map((t, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "upcoming";
          const isVerified = verified.has(n);
          return (
            <li key={i}>
              <button type="button" onClick={() => onJump(n)} className={itemClass(state, isVerified)}>
                {isVerified ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-emerald-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : state === "done" ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-green-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : state === "current" ? (
                  <span className="h-4 w-4 flex-none rounded-full border-2 border-brand" aria-hidden />
                ) : (
                  <span className="h-4 w-4 flex-none rounded-full border-2 border-line" aria-hidden />
                )}
                <span className="truncate">{n}. {t}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 border-t border-line pt-3">
        <StepProgress step={step} total={total} fixedSummary={fixedSummary} />
      </div>
    </nav>
  );
}

// <lg viewports: a horizontal scrollable row of rounded chips instead of the rail
// (and instead of the old native select). Same states/behavior as the rail.
function StepChips({
  step,
  total,
  titles,
  verified,
  fixedSummary,
  onJump,
}: {
  step: number;
  total: number;
  titles: string[];
  verified: Set<number>;
  fixedSummary?: string | null;
  onJump: (i: number) => void;
}) {
  const chipClass = (state: "done" | "current" | "upcoming", isVerified: boolean) =>
    `flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
      isVerified
        ? "bg-emerald-100 text-emerald-700"
        : state === "current"
        ? "bg-brand text-white"
        : state === "done"
        ? "bg-brand/10 text-brand"
        : "border border-line text-muted"
    }`;
  return (
    <div className="lg:hidden">
      <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => onJump(0)} className={chipClass(step === 0 ? "current" : "done", false)}>
          Overview
        </button>
        {titles.map((t, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "upcoming";
          const isVerified = verified.has(n);
          void t;
          return (
            <button key={i} type="button" onClick={() => onJump(n)} className={chipClass(state, isVerified)}>
              {isVerified ? "✓ " : state === "done" ? "✓ " : ""}Step {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        <StepProgress step={step} total={total} fixedSummary={fixedSummary} />
      </div>
    </div>
  );
}

// Step card header band: step title on the left, the (restyled, compact) track
// toggle on the right. Shown for both Overview and numbered steps.
function StepHeaderBand({
  step,
  title,
  hasTracks,
  track,
  onPickTrack,
}: {
  step: number; // 0 = Overview
  title: string;
  hasTracks: boolean;
  track: Track;
  onPickTrack: (t: Track) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#fafbff] px-5 py-3">
      <p className="font-semibold text-ink">{step === 0 ? "Overview" : title}</p>
      {hasTracks && step > 0 && <TrackToggle track={track} onPick={onPickTrack} />}
    </div>
  );
}

// Elapsed time since `sessionStartedAt`, mm format, rounded to the nearest minute
// (never shown as "0m" — floors at 1m once any time has passed so it doesn't read
// as broken). Returns null until we have both timestamps.
function elapsedMinutes(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const ms = Date.now() - start;
  return Math.max(ms > 0 ? 1 : 0, Math.round(ms / 60000));
}

// Completion moment (#3): rendered at the TOP of the step-content region once
// gradePassed flips true. Session-scoped dismissal — a plain useState in the
// parent is enough since this never needs to persist across reloads.
function CompletionCard({
  objectiveCount,
  sessionStartedAt,
  slug,
  onDismiss,
}: {
  objectiveCount: number;
  sessionStartedAt: string | null;
  slug: string;
  onDismiss: () => void;
}) {
  const lab = getLab(slug);
  const next = nextLab(slug);
  const mins = elapsedMinutes(sessionStartedAt);
  return (
    <div className="not-prose mb-5 overflow-hidden rounded-2xl border border-emerald-300/70 bg-emerald-50/60 shadow-sm">
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-emerald-500 text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <div>
            <p className="text-base font-extrabold text-emerald-800">
              All {objectiveCount} fix{objectiveCount === 1 ? "" : "es"} verified
            </p>
            {mins != null && (
              <p className="mt-0.5 text-sm text-emerald-700">Done in {mins}m — nice work.</p>
            )}
            {lab && lab.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lab.tags.map((t) => (
                  <span key={t} className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 font-mono text-xs text-emerald-700">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {next && (
              <Link href={`/labs/${next.slug}`} className="mt-3 inline-block text-sm font-semibold text-emerald-800 hover:underline">
                Keep going: {next.title} →
              </Link>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="flex-none rounded-md p-1 text-emerald-700/60 hover:bg-emerald-100 hover:text-emerald-800"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
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
  const { launched, objectiveStatus, gradePassed, sessionStartedAt } = useLabWorkspace();
  const [track, setTrack] = useState<Track>("console"); // default to point-and-click (beginner-friendly)
  const [remoteWt, setRemoteWt] = useState<string | null>(null); // gated walkthrough, once fetched
  const [stepIndex, setStepIndex] = useState(0); // 0 = Overview, 1..M = steps
  const [completionDismissed, setCompletionDismissed] = useState(false); // session-scoped (#3)
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

  // Step ↔ objective live verification (#1): a step is "verified" once ALL of its
  // mapped objective ids read "pass" in the mirrored grade context. Steps with no
  // marker (objectiveIds.length === 0) are never verified — unchanged/no affordance.
  const hasGradeData = Object.keys(objectiveStatus).length > 0;
  const verifiedSteps = useMemo(() => {
    const set = new Set<number>();
    if (!hasGradeData) return set;
    stepChunks.forEach((c, i) => {
      if (c.objectiveIds.length > 0 && c.objectiveIds.every((id) => objectiveStatus[id] === "pass")) {
        set.add(i + 1);
      }
    });
    return set;
  }, [stepChunks, objectiveStatus, hasGradeData]);

  // Orientation strip (#2): "X of Y fixed" — Y = every objective id referenced by
  // ANY step marker in this lab (the mechanism doesn't know the lab's full objective
  // list otherwise; it only sees what's mapped in content). Only shown once grading
  // data exists.
  const fixedSummary = useMemo(() => {
    if (!hasGradeData) return null;
    const allIds = new Set<string>();
    stepChunks.forEach((c) => c.objectiveIds.forEach((id) => allIds.add(id)));
    if (allIds.size === 0) return null;
    const passed = [...allIds].filter((id) => objectiveStatus[id] === "pass").length;
    return `${passed} of ${allIds.size} fixed`;
  }, [stepChunks, objectiveStatus, hasGradeData]);

  // Current step's mapped objectives all "pass" → the verified next-step prompt (#6).
  const currentStepVerified = stepIndex > 0 && verifiedSteps.has(stepIndex);

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
    // Scroll the guide card into view on step change, and start the new step's
    // content from the top (the walkthrough region scrolls internally on lg+).
    articleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    articleRef.current?.querySelector(".ss-walkthrough")?.scrollTo({ top: 0 });
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
    const showPlayer = hasWalkthrough && launched && wtSource !== null;
    const currentTitle = stepIndex === 0 ? "Overview" : headerTitles[stepIndex - 1] ?? "";
    const nextTitle = !isLastStep && stepIndex < headerTitles.length ? headerTitles[stepIndex] : "";

    return (
      <div
        className={
          showPlayer
            ? "lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6"
            : "lg:h-full lg:min-h-0"
        }
      >
        {showPlayer && (
          <StepRail
            step={stepIndex}
            total={totalSteps}
            titles={headerTitles}
            verified={verifiedSteps}
            fixedSummary={fixedSummary}
            onJump={goToStep}
          />
        )}
        <article
          ref={articleRef}
          className="lab-md ss-guide relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface lg:h-full lg:min-h-0"
          data-track={track}
        >
          {!hasWalkthrough || !launched ? (
            <div className="overflow-y-auto p-6 sm:p-7 lg:min-h-0 lg:flex-1 lg:overscroll-contain">
              {/* Cap the pre-launch prose to a readable measure (~70ch) so it reads
                  like a briefing, not a full-width wall; the launch-gate card below
                  and the post-launch walkthrough (with wide code blocks) stay full width. */}
              <div className="max-w-2xl">{overviewRendered.overviewNodes}</div>
              {!hasWalkthrough ? null : <LaunchGate steps={stepTitles} />}
            </div>
          ) : wtSource === null ? (
            <div className="overflow-y-auto p-6 sm:p-7 lg:min-h-0 lg:flex-1 lg:overscroll-contain">
              {overviewRendered.overviewNodes}
              <p className="mt-6 text-sm text-muted">Loading the walkthrough&hellip;</p>
            </div>
          ) : (
            <>
              <div className="flex-none">
                <StepHeaderBand
                  step={stepIndex}
                  title={currentTitle}
                  hasTracks={hasTracksAnywhere}
                  track={track}
                  onPickTrack={pick}
                />
                <div className="lg:hidden px-5 pt-3">
                  <StepChips
                    step={stepIndex}
                    total={totalSteps}
                    titles={headerTitles}
                    verified={verifiedSteps}
                    fixedSummary={fixedSummary}
                    onJump={goToStep}
                  />
                </div>
              </div>

              {/* Only this region scrolls on lg+ — the header band above and the
                  Back/Next footer below stay pinned so all controls are always
                  reachable without moving the page. overscroll-contain stops a
                  scroll-to-end here from chaining into the page. */}
              <div className="ss-walkthrough px-5 py-4 focus:outline-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain" tabIndex={-1}>
                {/* Completion moment (#3) — top of the step-content region, doesn't
                    replace content. Session-scoped dismissal. */}
                {gradePassed && !completionDismissed && (
                  <CompletionCard
                    objectiveCount={Object.keys(objectiveStatus).length}
                    sessionStartedAt={sessionStartedAt}
                    slug={slug}
                    onDismiss={() => setCompletionDismissed(true)}
                  />
                )}
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
                <div className="flex flex-none items-center justify-between gap-3 border-t border-line px-5 py-4">
                  <button type="button" onClick={onBack} disabled={stepIndex === 0} className={btnBack}>
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={onNext}
                    className={currentStepVerified ? btnNextVerified : btnNext}
                  >
                    {isLastStep
                      ? "Finish — check your work"
                      : currentStepVerified
                      ? nextTitle
                        ? `Verified — Next: ${nextTitle} →`
                        : "Verified — Next →"
                      : nextTitle
                      ? `Next: ${nextTitle} →`
                      : "Next →"}
                  </button>
                </div>
              )}
            </>
          )}
        </article>
      </div>
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
