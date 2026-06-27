"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { useLabWorkspace } from "@/components/lab-workspace";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Track = "console" | "cli";
type Segment = { kind: "common" | Track; text: string };

/**
 * Split the walkthrough into common prose + per-track (Console / CLI) blocks so the
 * learner can pick ONE style instead of wading through both stacked inline.
 * A track block runs from its 🖱️/⌨️ marker line until the next marker, the next
 * heading ("## …"), or a "---" rule. Fenced code is respected so a "#" or emoji
 * inside a ``` block is never treated as a delimiter.
 */
function splitTracks(md: string): Segment[] {
  const lines = md.split("\n");
  const segs: Segment[] = [];
  let cur: Segment = { kind: "common", text: "" };
  let inFence = false;
  const push = () => {
    const text = cur.text.replace(/\n+$/, "");
    if (text.trim()) segs.push({ kind: cur.kind, text });
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence) {
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

function TrackToggle({ track, onPick }: { track: Track; onPick: (t: Track) => void }) {
  const seg = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
      active ? "bg-brand text-white shadow-sm" : "text-ink-soft hover:bg-surface"
    }`;
  return (
    <div
      className="mb-6 flex items-center gap-1 rounded-xl border border-line bg-canvas p-1"
      role="tablist"
      aria-label="Instruction style"
    >
      <button role="tab" aria-selected={track === "console"} onClick={() => onPick("console")} className={seg(track === "console")}>
        🖱️ Console
      </button>
      <button role="tab" aria-selected={track === "cli"} onClick={() => onPick("cli")} className={seg(track === "cli")}>
        ⌨️ CLI
      </button>
      <span className="ml-auto pr-2 text-xs text-muted">Pick your style — switch anytime</span>
    </div>
  );
}

// Shown in place of the walkthrough until the learner launches the lab.
function LaunchGate() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-brand/40 bg-brand/5 p-6 text-center">
      <p className="text-2xl" aria-hidden>🚀</p>
      <p className="mt-2 text-base font-extrabold text-ink">Launch the lab to unlock the walkthrough</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
        Click <strong>Launch lab</strong> on the right to spin up your own isolated AWS account. The full
        step-by-step guide (with 🖱️ Console and ⌨️ CLI for every fix) unlocks the moment it&apos;s ready.
      </p>
    </div>
  );
}

export function LabGuide({ slug, instructions }: { slug: string; instructions: string }) {
  const { user, hasAccess, loading } = useAuth();
  const { launched } = useLabWorkspace();
  const [track, setTrack] = useState<Track>("console"); // default to point-and-click (beginner-friendly)

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

  // Parse the markdown ONCE (memoized on the source). Overview is always shown; the
  // walkthrough renders both Console+CLI tracks into the DOM and the toggle flips
  // which is visible purely via CSS (data-track on the article) — instant, no re-parse.
  const { overviewNodes, walkthroughNodes, hasTracks, hasWalkthrough } = useMemo(() => {
    const { overview, walkthrough } = splitGuide(instructions);
    const overviewNodes = (
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{overview}</ReactMarkdown>
    );
    const segs = splitTracks(walkthrough);
    const has = segs.some((s) => s.kind !== "common");
    const walkthroughNodes = segs.map((s, i) =>
      s.kind === "common" ? (
        <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
          {s.text}
        </ReactMarkdown>
      ) : (
        <div key={i} className={`ss-track ss-track-${s.kind}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.text}</ReactMarkdown>
        </div>
      )
    );
    return { overviewNodes, walkthroughNodes, hasTracks: has, hasWalkthrough: segs.length > 0 };
  }, [instructions]);

  // Free labs and already-paid users get immediate access.
  // hasAccess() returns true for free labs without needing entitlements.
  if (hasAccess(slug)) {
    return (
      <article className="lab-md ss-guide rounded-2xl border border-line bg-surface p-6 sm:p-7" data-track={track}>
        {overviewNodes}
        {!hasWalkthrough ? null : launched ? (
          <div className="ss-walkthrough">
            <div className="mt-6 mb-5 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-sm font-semibold text-brand">
              <span aria-hidden>✓</span> Lab launched — here&apos;s your full walkthrough
            </div>
            {hasTracks && <TrackToggle track={track} onPick={pick} />}
            {walkthroughNodes}
          </div>
        ) : (
          <LaunchGate />
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
