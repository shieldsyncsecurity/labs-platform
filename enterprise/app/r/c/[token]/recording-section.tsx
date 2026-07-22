"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Session-recording playback for the employer's candidate report: identity
 * shot, webcam snapshot filmstrip, sequential audio playback, and an HONEST
 * coverage line (interruptions and re-entries shown, never papered over).
 *
 * Presigned GET URLs (from /api/rec/list, authed by candidateReportToken — the
 * same revocable link that gates this page) expire after ~1h, so the component
 * re-fetches the listing when any media element errors (a report left open past
 * the window recovers instead of showing broken glyphs).
 *
 * Renders NOTHING for sessions with no recording (pre-feature results, or a
 * fully-denied capture). A transient LOAD FAILURE is shown distinctly from "no
 * recording", so an engine blip is never mistaken for "the candidate wasn't
 * recorded".
 */

type MediaEntry = { epoch: number; seq: number; url: string; size: number; at: string | null };
type RecEvent = { t: string; at: string };
type RecData = {
  id: MediaEntry | null;
  reentryIds?: MediaEntry[];
  snaps: MediaEntry[];
  audio: MediaEntry[];
  epochCount?: number;
  truncated?: boolean;
  events?: RecEvent[];
};

// Audio is captured at a fixed 32 kbps (recorder.ts) = 4000 bytes/s, so total
// duration derives from byte size — correct for BOTH 15s and 30s (degraded)
// chunks, unlike assuming a fixed chunk count × 15s.
const AUDIO_BYTES_PER_SEC = 4000;

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function RecordingSection({ token }: { token: string }) {
  const [data, setData] = useState<RecData | null>(null);
  const [loadError, setLoadError] = useState(false); // transient (5xx/network) — distinct from "none"
  const [notFound, setNotFound] = useState(false); // 404 — genuinely no recording
  const [audioIdx, setAudioIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const refreshingRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const fetchListing = useCallback(async (): Promise<RecData | null> => {
    try {
      const res = await fetch("/api/rec/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateReportToken: token }),
      });
      if (res.status === 404) {
        setNotFound(true);
        return null;
      }
      if (!res.ok) {
        setLoadError(true);
        return null;
      }
      const d = (await res.json()) as RecData;
      setLoadError(false);
      setData(d);
      return d;
    } catch {
      setLoadError(true);
      return null;
    }
  }, [token]);

  useEffect(() => {
    void fetchListing();
  }, [fetchListing]);

  // Any media element erroring (typically a presigned URL past its ~1h expiry)
  // triggers ONE listing refresh to mint fresh URLs; the re-render reloads media.
  const refreshMedia = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      await fetchListing();
    } finally {
      // brief cooldown so a burst of onError from many <img>s coalesces
      setTimeout(() => {
        refreshingRef.current = false;
      }, 2000);
    }
  }, [fetchListing]);

  const interruptions = useMemo(
    // Count INCIDENTS, not events: a device loss emits "gap" then (on failed
    // re-acquire) "denied" — collapse the pair into one. Counting "gap" alone
    // does that, since every incident starts with a gap.
    () => (data?.events ?? []).filter((e) => e.t === "gap").length,
    [data]
  );

  // Escape-to-close + body scroll lock while the lightbox is open (a11y).
  useEffect(() => {
    if (!lightbox) return;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox]);

  if (notFound) return null; // genuinely no recording for this session
  if (loadError && !data) {
    // Transient failure with nothing cached — say so, don't imply "not recorded".
    return (
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Session recording</h2>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-sm text-ink-soft shadow-sm sm:px-6">
          <span>The session recording could not be loaded right now (a temporary issue).</span>
          <button
            type="button"
            onClick={() => { setLoadError(false); void fetchListing(); }}
            className="rounded-md border border-line-strong px-3 py-1 text-xs font-semibold text-ink-soft hover:border-brand hover:text-brand-strong"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (!data) return null; // still loading; pops in when ready
  const hasMedia = Boolean(data.id) || data.snaps.length > 0 || data.audio.length > 0;
  if (!hasMedia) return null;

  const first = data.snaps[0]?.at ?? data.audio[0]?.at ?? null;
  const last = data.audio[data.audio.length - 1]?.at ?? data.snaps[data.snaps.length - 1]?.at ?? null;
  const audioBytes = data.audio.reduce((s, a) => s + (a.size || 0), 0);
  const audioMin = Math.max(0, Math.round(audioBytes / AUDIO_BYTES_PER_SEC / 60));
  const reentries = Math.max(0, (data.epochCount ?? 1) - 1);

  const playIdx = (i: number) => {
    const clamped = Math.max(0, Math.min(data.audio.length - 1, i));
    setAudioIdx(clamped);
    setPlaying(true);
    requestAnimationFrame(() => {
      const el = audioRef.current;
      if (el) {
        el.src = data.audio[clamped].url;
        void el.play().catch(() => setPlaying(false));
      }
    });
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Session recording</h2>
        <span className="font-mono text-xs text-muted">
          {data.snaps.length} snapshots · ~{audioMin} min audio
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        {/* Coverage line — honest by construction. Times are UPLOAD times (they
            can lag capture by a minute or two on a slow link); the wording says
            so rather than claiming exact capture times. */}
        <div className="border-b border-line/70 bg-canvas/40 px-5 py-3 text-xs text-ink-soft sm:px-6">
          Webcam snapshots (every 15–30s) + microphone audio, uploaded{" "}
          {first ? `from ${fmtTime(first)}` : ""}
          {last ? ` to ${fmtTime(last)}` : ""}.{" "}
          {interruptions > 0 ? (
            <span className="font-medium text-amber-700">
              {interruptions} coverage interruption{interruptions === 1 ? "" : "s"} (device or
              permission loss) — gaps are shown, not hidden.
            </span>
          ) : (
            <span>No coverage interruptions recorded.</span>
          )}
          {reentries > 0 ? (
            <span className="ml-1 font-medium text-amber-700">
              {" "}The candidate re-entered the session {reentries} time{reentries === 1 ? "" : "s"}{" "}
              (page reload) — see the additional start photo{reentries === 1 ? "" : "s"} below.
            </span>
          ) : null}
          {data.truncated ? " Listing truncated to the first 1000 items." : ""}
        </div>

        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start gap-5">
            {data.id ? (
              <figure className="flex-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <button type="button" onClick={() => setLightbox(data.id!.url)} className="block cursor-zoom-in rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                  <img
                    src={data.id.url}
                    alt="Candidate identity snapshot at session start"
                    className="h-28 w-auto rounded-lg border border-line object-cover"
                    onError={() => void refreshMedia()}
                  />
                </button>
                <figcaption className="mt-1 text-[11px] text-muted">At session start</figcaption>
              </figure>
            ) : null}

            {/* Re-entry identity shots — who resumed after each reload. */}
            {(data.reentryIds ?? []).map((r, i) => (
              <figure key={`re-${r.epoch}`} className="flex-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <button type="button" onClick={() => setLightbox(r.url)} className="block cursor-zoom-in rounded-lg ring-1 ring-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                  <img src={r.url} alt={`Candidate at re-entry ${i + 1}`} className="h-28 w-auto rounded-lg object-cover" onError={() => void refreshMedia()} />
                </button>
                <figcaption className="mt-1 text-[11px] text-amber-700">Re-entry {i + 1}</figcaption>
              </figure>
            ))}

            {data.audio.length > 0 ? (
              <div className="min-w-64 flex-1">
                <p className="text-xs font-medium text-ink">
                  Microphone audio{" "}
                  <span className="font-normal text-muted">
                    — clip {audioIdx + 1} of {data.audio.length}
                    {data.audio[audioIdx]?.at ? ` · ${fmtTime(data.audio[audioIdx].at)}` : ""}
                  </span>
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => playIdx(audioIdx - 1)} disabled={audioIdx === 0} className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-ink-soft hover:border-brand disabled:opacity-40">← Prev</button>
                  <button type="button" onClick={() => (playing ? audioRef.current?.pause() : playIdx(audioIdx))} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-strong">{playing ? "Pause" : "Play from here"}</button>
                  <button type="button" onClick={() => playIdx(audioIdx + 1)} disabled={audioIdx >= data.audio.length - 1} className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-ink-soft hover:border-brand disabled:opacity-40">Next →</button>
                </div>
                <audio
                  ref={audioRef}
                  className="mt-2 w-full"
                  controls
                  preload="none"
                  onPause={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onEnded={() => {
                    if (audioIdx < data.audio.length - 1) playIdx(audioIdx + 1);
                    else setPlaying(false);
                  }}
                  onError={() => void refreshMedia()}
                />
              </div>
            ) : (
              <p className="text-sm text-muted">No audio was captured for this session.</p>
            )}
          </div>

          {data.snaps.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium text-ink">Webcam timeline</p>
              <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6 md:grid-cols-8">
                {data.snaps.map((s) => (
                  <button
                    key={`${s.epoch}-${s.seq}`}
                    type="button"
                    onClick={() => setLightbox(s.url)}
                    className="cursor-zoom-in rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                    title={s.at ? fmtTime(s.at) : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.url}
                      alt={`Snapshot${s.at ? ` at ${fmtTime(s.at)}` : ""}`}
                      loading="lazy"
                      className="aspect-video w-full rounded border border-line/60 object-cover"
                      onError={() => void refreshMedia()}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">No webcam snapshots were captured for this session.</p>
          )}
        </div>
      </div>

      {/* Lightbox — role=dialog, focus moved to the close control, Escape closes,
          body scroll locked (see effect above). */}
      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged snapshot"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            Close ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Enlarged snapshot"
            className="max-h-full max-w-full cursor-zoom-out rounded-lg"
            onClick={(e) => e.stopPropagation()}
            onError={() => void refreshMedia()}
          />
        </div>
      ) : null}
    </section>
  );
}
