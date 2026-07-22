"use client";

/**
 * SessionRecorder — proctoring capture for the live candidate assessment.
 *
 * CAPTURE EPOCH: on start() the recorder asks the engine (/api/rec/start) for a
 * monotonic epoch and namespaces every upload under it. A page reload creates a
 * new recorder → a new epoch → a fresh key space, so a reload can NEVER overwrite
 * the earlier half of the recording (or the identity shot). The employer report
 * shows extra epochs as re-entries instead of losing the first one.
 *
 * CYCLE-BASED: every cycle (15s normal / 30s degraded) produces one STANDALONE
 * audio file (MediaRecorder start→stop per cycle, so each blob is independently
 * playable — a lost chunk never corrupts the rest) plus one JPEG snapshot.
 * Uploads go DIRECTLY to S3 via presigned PUTs; each PUT is size-bound.
 *
 * FAILURE POLICY: fail-closed at start (the caller only starts the session once
 * permission is granted), fail-open mid-session with an HONEST trail — uploads
 * retry/backoff; repeated failures degrade cadence/quality; a device/permission
 * loss pauses capture (loop fully stopped, no frozen frames) with a gap/denied
 * event; the room offers one-click re-enable.
 *
 * All re-acquire paths are serialized (a single `reacquiring` guard) and every
 * async continuation re-checks a monotonic `generation`, so a stop() or a
 * concurrent track-loss can never resurrect capture or spawn a second loop.
 */

type RecStatus = "recording" | "paused" | "degraded" | "stopped";

type PresignItem = { kind: "id" | "snap" | "audio"; seq: number; contentType: string; size: number };
type PresignedUpload = { kind: string; seq: number; url: string };

const NORMAL_CYCLE_MS = 15_000;
const DEGRADED_CYCLE_MS = 30_000;
const DEGRADE_AFTER_FAILURES = 3;
const MAX_QUEUE = 16; // ~2 min of capture; drop-oldest beyond it (bounded memory)

export class SessionRecorder {
  private inviteToken: string;
  private onStatus: (s: RecStatus) => void;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private recorder: MediaRecorder | null = null;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private stopped = false; // terminal: set by stop(); no path may re-activate after
  private reacquiring = false; // serializes handleTrackLost + retry
  private generation = 0; // bumped on every teardown; async continuations bail if it moved
  private degraded = false;
  private consecutiveFailures = 0;
  private epoch: number | null = null;
  private snapSeq = 0;
  private audioSeq = 0;
  private audioMime: string | null = null;
  private queue: { item: PresignItem; blob: Blob }[] = [];
  private draining = false;
  private idUploaded = false;

  constructor(inviteToken: string, onStatus: (s: RecStatus) => void) {
    this.inviteToken = inviteToken;
    this.onStatus = onStatus;
  }

  /** Start capturing from an already-granted stream. Allocates a capture epoch
   *  first; if that fails, stays paused with a gap event (the caller shows the
   *  re-enable banner) rather than uploading to an unknown key space. */
  async start(stream: MediaStream): Promise<void> {
    if (this.stopped) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const gen = this.generation;
    this.stream = stream;
    this.active = true;

    const epoch = await this.allocateEpoch();
    if (this.stopped || gen !== this.generation) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    if (epoch === null) {
      // Could not allocate an epoch (engine unreachable / session not writable).
      this.onStatus("paused");
      this.sendEvent("gap");
      for (const t of stream.getTracks()) t.stop();
      this.stream = null;
      this.active = false;
      return;
    }
    this.epoch = epoch;

    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play().catch(() => {});
    if (this.stopped || gen !== this.generation) {
      // stop()/re-acquire happened during play(): abandon this attempt cleanly.
      v.srcObject = null;
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.video = v;

    for (const track of stream.getTracks()) {
      track.onended = () => this.handleTrackLost();
    }

    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) this.audioMime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/webm")) this.audioMime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) this.audioMime = "audio/mp4";
    }

    this.onStatus(this.degraded ? "degraded" : "recording");
    this.sendEvent("start");
    void this.captureSnapshot(true);
    this.beginCycle();
  }

  private async allocateEpoch(): Promise<number | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/rec/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inviteToken: this.inviteToken }),
        });
        if (res.ok) {
          const d = (await res.json()) as { epoch?: number };
          if (typeof d.epoch === "number") return d.epoch;
        } else if (res.status === 409) {
          return null; // session not writable (submitted/erased) — don't retry
        }
      } catch {
        /* network — retry */
      }
      if (attempt < 2) await this.sleep(attempt === 0 ? 1000 : 3000);
    }
    return null;
  }

  private beginCycle() {
    if (!this.active || this.stopped || !this.stream || this.epoch === null) return;
    const cycleMs = this.degraded ? DEGRADED_CYCLE_MS : NORMAL_CYCLE_MS;
    const gen = this.generation;

    if (this.audioMime) {
      const audioTracks = this.stream.getAudioTracks().filter((t) => t.readyState === "live");
      if (audioTracks.length > 0) {
        try {
          const rec = new MediaRecorder(new MediaStream(audioTracks), {
            mimeType: this.audioMime,
            audioBitsPerSecond: 32_000,
          });
          const parts: Blob[] = [];
          rec.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) parts.push(e.data);
          };
          rec.onstop = () => {
            // Bail if a teardown/stop happened while this recorder ran.
            if (gen !== this.generation) return;
            if (parts.length > 0) {
              const blob = new Blob(parts, { type: this.audioMime! });
              this.enqueue({ kind: "audio", seq: this.audioSeq++, contentType: this.audioMime!, size: blob.size }, blob);
            }
            void this.captureSnapshot(false);
            if (this.active && !this.stopped) this.beginCycle();
          };
          rec.start();
          this.recorder = rec;
          this.cycleTimer = setTimeout(() => {
            try { if (rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ }
          }, cycleMs);
          return;
        } catch {
          this.audioMime = null; // recorder construction failed → snapshots-only
        }
      }
    }

    // Snapshots-only fallback (no usable audio recorder): plain timer cadence.
    this.cycleTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      void this.captureSnapshot(false);
      if (this.active && !this.stopped) this.beginCycle();
    }, cycleMs);
  }

  private async captureSnapshot(isIdentity: boolean) {
    const v = this.video;
    if (!v || !this.stream || this.epoch === null) return;
    if (this.stopped || (!this.active && !isIdentity)) return;
    if (isIdentity && this.idUploaded) return;
    // Only capture from a LIVE video track — a dead/ended track leaves the
    // <video> painting a frozen last frame; uploading that as "current" would
    // contradict the paused/gap trail.
    const vtrack = this.stream.getVideoTracks()[0];
    if (!vtrack || vtrack.readyState !== "live") return;
    const vw = v.videoWidth || 640;
    const vh = v.videoHeight || 480;
    if (vw === 0 || vh === 0) return;
    const targetW = isIdentity ? 960 : this.degraded ? 480 : 640;
    const w = Math.min(targetW, vw);
    const h = Math.round((w / vw) * vh);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    const quality = isIdentity ? 0.85 : this.degraded ? 0.5 : 0.72;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size === 0) return;
    if (isIdentity) {
      this.idUploaded = true;
      this.enqueue({ kind: "id", seq: 0, contentType: "image/jpeg", size: blob.size }, blob);
    } else {
      this.enqueue({ kind: "snap", seq: this.snapSeq++, contentType: "image/jpeg", size: blob.size }, blob);
    }
  }

  private enqueue(item: PresignItem, blob: Blob) {
    this.queue.push({ item, blob });
    while (this.queue.length > MAX_QUEUE) this.queue.shift(); // drop-oldest, bounded
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const head = this.queue[0];
        const ok = await this.uploadOne(head.item, head.blob);
        // Identity-based removal: an overflow drop-oldest during the await may
        // have shifted `head` out already, so never blindly shift() — remove the
        // exact entry we uploaded, or nothing if it was already dropped.
        const i = this.queue.indexOf(head);
        if (i !== -1) this.queue.splice(i, 1);
        if (ok) {
          this.consecutiveFailures = 0;
        } else {
          this.consecutiveFailures++;
          this.sendEvent("upload_failed");
          if (!this.degraded && this.consecutiveFailures >= DEGRADE_AFTER_FAILURES) {
            this.degraded = true;
            if (!this.stopped) this.onStatus("degraded");
            this.sendEvent("degraded");
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** presign + PUT with retry/backoff. Returns false only after final failure. */
  private async uploadOne(item: PresignItem, blob: Blob): Promise<boolean> {
    if (this.epoch === null) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pres = await fetch("/api/rec/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inviteToken: this.inviteToken, epoch: this.epoch, items: [item] }),
        });
        if (!pres.ok) {
          // 409 (submitted/erased/stale-epoch) and 429 (cap) are terminal.
          if (pres.status === 409 || pres.status === 429) return false;
          throw new Error(`presign ${pres.status}`);
        }
        const data = (await pres.json()) as { uploads?: PresignedUpload[] };
        const url = data.uploads?.[0]?.url;
        if (!url) throw new Error("no url");
        const put = await fetch(url, {
          method: "PUT",
          headers: { "content-type": item.contentType },
          body: blob,
        });
        if (!put.ok) throw new Error(`put ${put.status}`);
        return true;
      } catch {
        if (attempt < 2) await this.sleep(attempt === 0 ? 1000 : 4000);
      }
    }
    return false;
  }

  private async handleTrackLost() {
    if (!this.active || this.stopped || this.reacquiring) return;
    this.reacquiring = true;
    this.onStatus("paused");
    this.sendEvent("gap");
    // Fully stop the current (dead) capture loop so no frozen-frame snapshots or
    // orphaned recorders survive while we try to recover.
    this.teardownMedia();
    const gen = this.generation;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (this.stopped || gen !== this.generation) {
        for (const t of fresh.getTracks()) t.stop();
        return;
      }
      this.stopped = false;
      this.active = true;
      await this.start(fresh);
      if (this.epoch !== null) this.sendEvent("resume");
    } catch {
      this.sendEvent("denied");
      // Stay paused (loop already torn down); the room banner offers re-enable.
    } finally {
      this.reacquiring = false;
    }
  }

  /** Room banner CTA: re-enable after a device/permission loss. */
  async retry(): Promise<boolean> {
    if (this.stopped || this.reacquiring) return false;
    this.reacquiring = true;
    this.teardownMedia();
    const gen = this.generation;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (this.stopped || gen !== this.generation) {
        for (const t of fresh.getTracks()) t.stop();
        return false;
      }
      this.stopped = false;
      this.active = true;
      await this.start(fresh);
      const ok = this.epoch !== null;
      if (ok) this.sendEvent("resume");
      return ok;
    } catch {
      return false;
    } finally {
      this.reacquiring = false;
    }
  }

  private sendEvent(type: string) {
    fetch("/api/rec/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteToken: this.inviteToken, type }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Beacon-safe stop notice for pagehide paths (no async work possible there). */
  beaconStop() {
    const payload = JSON.stringify({ inviteToken: this.inviteToken, type: "stop" });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/rec/event", new Blob([payload], { type: "application/json" }));
    }
  }

  // Tears down the media pipeline WITHOUT marking the recorder terminal, and
  // bumps `generation` so any in-flight cycle/continuation self-cancels.
  private teardownMedia() {
    this.generation++;
    this.active = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    if (this.recorder) {
      // Detach BEFORE stop so a pending onstop can't spawn a new cycle or enqueue.
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      try { if (this.recorder.state !== "inactive") this.recorder.stop(); } catch { /* already */ }
      this.recorder = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
      this.stream = null;
    }
  }

  /** Stop capturing, flush what we can (bounded), release the devices. Terminal. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const finalRecorder = this.recorder;
    this.active = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    // Deterministically wait for the final recorder's LAST chunk to land in the
    // queue before draining — a fixed sleep could miss a slow stop event and
    // drop up to a full cycle of the most dispute-relevant final audio.
    if (finalRecorder && finalRecorder.state !== "inactive") {
      await Promise.race([
        new Promise<void>((res) => {
          finalRecorder.addEventListener("stop", () => res(), { once: true });
          try { finalRecorder.stop(); } catch { res(); }
        }),
        this.sleep(4000),
      ]);
    }
    // Drain the queue (bounded), then release the camera.
    await Promise.race([
      (async () => {
        while (this.queue.length > 0 || this.draining) await this.sleep(200);
      })(),
      this.sleep(5000),
    ]);
    this.sendEvent("stop");
    // Detach the final recorder's handlers and release devices.
    this.generation++;
    if (finalRecorder) {
      finalRecorder.onstop = null;
      finalRecorder.ondataavailable = null;
    }
    this.recorder = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
      this.stream = null;
    }
    this.onStatus("stopped");
  }

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }
}
