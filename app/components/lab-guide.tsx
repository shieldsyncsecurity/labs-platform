"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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

// Sticky so it's always reachable while scrolling the steps. The caption swaps with
// the track, so flipping it is visibly confirmed even before you look at the steps.
function TrackToggle({ track, onPick }: { track: Track; onPick: (t: Track) => void }) {
  const seg = (active: boolean) =>
    `flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
      active ? "bg-brand text-white shadow-sm" : "text-ink-soft hover:bg-surface"
    }`;
  return (
    <div
      className="ss-toggle sticky top-2 z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas p-1.5 shadow-sm"
      role="tablist"
      aria-label="Instruction style"
    >
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
  const { overviewNodes, localWalkthrough } = useMemo(() => {
    const { overview, walkthrough } = splitGuide(instructions);
    return {
      overviewNodes: (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{overview}</ReactMarkdown>
      ),
      localWalkthrough: walkthrough,
    };
  }, [instructions]);

  const wtSource = gatedSlug ? remoteWt : localWalkthrough;
  const hasWalkthrough = gatedSlug ? true : localWalkthrough.trim().length > 0;

  // Split the rendered walkthrough into the leading reference card(s) and the step
  // body so we can sit the sticky toggle BETWEEN them — refcard scrolls away, then
  // Step 1 sits directly under the pinned toggle (so flipping it is visible at once).
  const { refcardNodes, stepNodes, hasTracks } = useMemo(() => {
    const segs = splitTracks(wtSource ?? "");
    const refcardNodes: ReactNode[] = [];
    const stepNodes: ReactNode[] = [];
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
      stepNodes.push(
        s.kind === "common" ? (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>{src}</ReactMarkdown>
        ) : (
          <div key={i} className={`ss-track ss-track-${s.kind}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{src}</ReactMarkdown>
          </div>
        )
      );
    });
    return {
      refcardNodes,
      stepNodes,
      hasTracks: segs.some((s) => s.kind === "console" || s.kind === "cli"),
    };
  }, [wtSource]);

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

  // Free labs and already-paid users get immediate access.
  // hasAccess() returns true for free labs without needing entitlements.
  if (hasAccess(slug)) {
    return (
      <article className="lab-md ss-guide rounded-2xl border border-line bg-surface p-6 sm:p-7" data-track={track}>
        {overviewNodes}
        {!hasWalkthrough ? null : launched ? (
          <div className="ss-walkthrough mt-6">
            {wtSource === null ? (
              <p className="text-sm text-muted">Loading the walkthrough&hellip;</p>
            ) : (
              <>
                {refcardNodes}
                {hasTracks && <TrackToggle track={track} onPick={pick} />}
                {stepNodes}
              </>
            )}
          </div>
        ) : (
          <LaunchGate steps={stepTitles} />
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
