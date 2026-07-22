"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Session-recording playback for the employer's candidate report: identity
 * shot, webcam snapshot filmstrip, sequential audio playback, and an HONEST
 * coverage line (interruptions are shown, never papered over).
 *
 * Fetches presigned GET URLs via /api/rec/list (candidateReportToken auth —
 * the same revocable link that gates this page). Renders NOTHING for sessions
 * with no recording (pre-feature results, or a fully-denied capture) so old
 * reports are untouched.
 */

type MediaEntry = { seq: number; url: string; size: number; at: string | null };
type RecEvent = { t: string; at: string };
type RecData = {
  id: MediaEntry | null;
  snaps: MediaEntry[];
  audio: MediaEntry[];
  truncated?: boolean;
  events?: RecEvent[];
};

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function RecordingSection({ token }: { token: string }) {
  const [data, setData] = useState<RecData | null>(null);
  const [failed, setFailed] = useState(false);
  const [audioIdx, setAudioIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/rec/list", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidateReportToken: token }),
        });
        if (!res.ok) {
          if (alive) setFailed(true);
          return;
        }
        const d = (await res.json()) as RecData;
        if (alive) setData(d);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const interruptions = useMemo(
    () => (data?.events ?? []).filter((e) => e.t === "gap" || e.t === "denied").length,
    [data]
  );

  // Nothing recorded (older session / list unavailable): render nothing —
  // the report stands on the verified checks either way.
  if (failed) return null;
  if (!data) return null; // still loading; the section pops in when ready
  const hasMedia = Boolean(data.id) || data.snaps.length > 0 || data.audio.length > 0;
  if (!hasMedia) return null;

  const first = data.snaps[0]?.at ?? data.audio[0]?.at ?? null;
  const lastSnap = data.snaps[data.snaps.length - 1]?.at ?? null;
  const lastAudio = data.audio[data.audio.length - 1]?.at ?? null;
  const last = lastAudio ?? lastSnap;
  const audioMin = Math.round((data.audio.length * 15) / 60);

  const playIdx = (i: number) => {
    const clamped = Math.max(0, Math.min(data.audio.length - 1, i));
    setAudioIdx(clamped);
    setPlaying(true);
    // Set src + play on the same element so onEnded chaining keeps working.
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Session recording
        </h2>
        <span className="font-mono text-xs text-muted">
          {data.snaps.length} snapshots · ~{audioMin} min audio
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        {/* Coverage line — honest by construction */}
        <div className="border-b border-line/70 bg-canvas/40 px-5 py-3 text-xs text-ink-soft sm:px-6">
          Webcam snapshots (~every 15s) + microphone audio, captured{" "}
          {first ? `from ${fmtTime(first)}` : ""}
          {last ? ` to ${fmtTime(last)}` : ""}.{" "}
          {interruptions > 0 ? (
            <span className="font-medium text-amber-700">
              {interruptions} coverage interruption{interruptions === 1 ? "" : "s"} recorded (device
              or permission loss) — gaps are real, not hidden.
            </span>
          ) : (
            <span>No coverage interruptions recorded.</span>
          )}
          {data.truncated ? " Listing truncated to the first 1000 items." : ""}
        </div>

        <div className="flex flex-col gap-5 p-5 sm:p-6">
          {/* Identity + audio player row */}
          <div className="flex flex-wrap items-start gap-5">
            {data.id ? (
              <figure className="flex-none">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.id.url}
                  alt="Candidate identity snapshot at session start"
                  className="h-28 w-auto cursor-zoom-in rounded-lg border border-line object-cover"
                  onClick={() => setLightbox(data.id!.url)}
                />
                <figcaption className="mt-1 text-[11px] text-muted">At session start</figcaption>
              </figure>
            ) : null}

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
                  <button
                    type="button"
                    onClick={() => playIdx(audioIdx - 1)}
                    disabled={audioIdx === 0}
                    className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-ink-soft hover:border-brand disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => (playing ? audioRef.current?.pause() : playIdx(audioIdx))}
                    className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:bg-brand-strong"
                  >
                    {playing ? "Pause" : "Play from here"}
                  </button>
                  <button
                    type="button"
                    onClick={() => playIdx(audioIdx + 1)}
                    disabled={audioIdx >= data.audio.length - 1}
                    className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-ink-soft hover:border-brand disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
                {/* Clips auto-chain: each ~15s standalone file plays into the next. */}
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
                />
              </div>
            ) : (
              <p className="text-sm text-muted">No audio was captured for this session.</p>
            )}
          </div>

          {/* Snapshot filmstrip */}
          {data.snaps.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium text-ink">Webcam timeline</p>
              <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-6 md:grid-cols-8">
                {data.snaps.map((s) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={s.seq}
                    src={s.url}
                    alt={`Snapshot ${s.seq + 1}${s.at ? ` at ${fmtTime(s.at)}` : ""}`}
                    loading="lazy"
                    className="aspect-video w-full cursor-zoom-in rounded border border-line/60 object-cover"
                    onClick={() => setLightbox(s.url)}
                    title={s.at ? fmtTime(s.at) : undefined}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">No webcam snapshots were captured for this session.</p>
          )}
        </div>
      </div>

      {/* Minimal lightbox */}
      {lightbox ? (
        <button
          type="button"
          aria-label="Close enlarged snapshot"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Enlarged snapshot" className="max-h-full max-w-full rounded-lg" />
        </button>
      ) : null}
    </section>
  );
}
