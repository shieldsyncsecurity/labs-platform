"use client";

/**
 * SessionRecorder — proctoring capture for the live candidate assessment.
 *
 * CYCLE-BASED: every cycle (15s normal / 30s degraded) produces
 *   - one STANDALONE audio file (MediaRecorder start→stop per cycle, so each
 *     blob has its own container header and is independently playable — a lost
 *     chunk never corrupts the rest, unlike timeslice fragments), and
 *   - one JPEG webcam snapshot drawn from the live video track.
 * Captures upload DIRECTLY to S3 via presigned PUTs from /api/rec/presign.
 * Because the cycle is driven by MediaRecorder's own onstop event (the media
 * pipeline), it keeps firing in a background tab while the candidate works in
 * the AWS-console tab — and Chrome exempts tabs with live capture from
 * intensive timer throttling anyway.
 *
 * FAILURE POLICY (mirrors the product stance: fail-closed at start, fail-open
 * mid-session with an honest trail): uploads retry with backoff; repeated
 * failures degrade cadence/quality rather than interrupting the candidate;
 * every degrade/gap/denial is reported via /api/rec/event so the employer
 * report can show real coverage instead of pretending.
 */

type RecStatus = "recording" | "paused" | "degraded" | "stopped";

type PresignItem = { kind: "id" | "snap" | "audio"; seq: number; contentType: string };
type PresignedUpload = { kind: string; seq: number; url: string };

const NORMAL_CYCLE_MS = 15_000;
const DEGRADED_CYCLE_MS = 30_000;
// Consecutive upload failures before degrading capture quality/cadence.
const DEGRADE_AFTER_FAILURES = 3;
// Bounded local queue: if the network is fully down we keep at most this many
// pending blobs (~2 min of capture) and drop the oldest beyond it — recording
// must never grow unbounded in the candidate's memory.
const MAX_QUEUE = 16;

export class SessionRecorder {
  private inviteToken: string;
  private onStatus: (s: RecStatus) => void;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private recorder: MediaRecorder | null = null;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private degraded = false;
  private consecutiveFailures = 0;
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

  /** Start capturing from an already-granted stream (fail-closed at start:
   *  the caller acquires the stream and only starts the session once granted). */
  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.active = true;

    // Hidden <video> feeding canvas snapshots.
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play().catch(() => {});
    this.video = v;

    // A dying track (device unplugged, permission pulled from the address bar)
    // is a gap, not an error the candidate should suffer for: log it and try
    // one silent re-acquire; if that fails, stay paused with an honest trail.
    for (const track of stream.getTracks()) {
      track.onended = () => this.handleTrackLost();
    }

    // Audio container per browser: webm/opus (Chromium/Firefox), mp4 (Safari).
    if (typeof MediaRecorder !== "undefined") {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) this.audioMime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/webm")) this.audioMime = "audio/webm";
      else if (MediaRecorder.isTypeSupported("audio/mp4")) this.audioMime = "audio/mp4";
    }

    this.onStatus("recording");
    this.sendEvent("start");
    // Identity shot first (higher resolution, seq 0), then the cycle loop.
    void this.captureSnapshot(true);
    this.beginCycle();
  }

  private beginCycle() {
    if (!this.active || !this.stream) return;
    const cycleMs = this.degraded ? DEGRADED_CYCLE_MS : NORMAL_CYCLE_MS;

    if (this.audioMime) {
      const audioTracks = this.stream.getAudioTracks();
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
            if (parts.length > 0) {
              const blob = new Blob(parts, { type: this.audioMime! });
              this.enqueue({ kind: "audio", seq: this.audioSeq++, contentType: this.audioMime! }, blob);
            }
            // Snapshot rides the cycle boundary; then next cycle. Driven from
            // the media pipeline's own event → throttle-resistant.
            void this.captureSnapshot(false);
            if (this.active) this.beginCycle();
          };
          rec.start();
          this.recorder = rec;
          this.cycleTimer = setTimeout(() => {
            try { rec.state !== "inactive" && rec.stop(); } catch { /* already stopped */ }
          }, cycleMs);
          return;
        } catch {
          this.audioMime = null; // recorder construction failed → snapshots-only
        }
      }
    }

    // Snapshots-only fallback (no usable audio recorder): plain timer cadence.
    this.cycleTimer = setTimeout(() => {
      void this.captureSnapshot(false);
      if (this.active) this.beginCycle();
    }, cycleMs);
  }

  private async captureSnapshot(isIdentity: boolean) {
    const v = this.video;
    if (!v || !this.stream || (!this.active && !isIdentity)) return;
    if (isIdentity && this.idUploaded) return;
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
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", quality)
    );
    if (!blob || blob.size === 0) return;
    if (isIdentity) {
      this.idUploaded = true;
      this.enqueue({ kind: "id", seq: 0, contentType: "image/jpeg" }, blob);
    } else {
      this.enqueue({ kind: "snap", seq: this.snapSeq++, contentType: "image/jpeg" }, blob);
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
        const { item, blob } = this.queue[0];
        const ok = await this.uploadOne(item, blob);
        this.queue.shift();
        if (ok) {
          this.consecutiveFailures = 0;
          if (this.degraded) this.onStatus("degraded");
        } else {
          this.consecutiveFailures++;
          this.sendEvent("upload_failed");
          if (!this.degraded && this.consecutiveFailures >= DEGRADE_AFTER_FAILURES) {
            this.degraded = true;
            this.onStatus("degraded");
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pres = await fetch("/api/rec/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inviteToken: this.inviteToken, items: [item] }),
        });
        if (!pres.ok) {
          // 409 (submitted/expired) and 429 (cap) are terminal — stop retrying.
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
        if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 4000));
      }
    }
    return false;
  }

  private async handleTrackLost() {
    if (!this.active) return;
    this.onStatus("paused");
    this.sendEvent("gap");
    // One silent re-acquire (permission usually still granted — e.g. the OS
    // switched default devices). More than one attempt would loop on hard denial.
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.teardownMedia();
      this.active = true;
      await this.start(fresh);
      this.sendEvent("resume");
    } catch {
      this.sendEvent("denied");
      // Stay paused; the room banner asks the candidate to re-enable.
    }
  }

  /** Try to restart after the candidate re-grants permission (room banner CTA). */
  async retry(): Promise<boolean> {
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.teardownMedia();
      this.active = true;
      await this.start(fresh);
      this.sendEvent("resume");
      return true;
    } catch {
      return false;
    }
  }

  private sendEvent(type: string) {
    // Fire-and-forget; keepalive so a stop event survives page teardown.
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

  private teardownMedia() {
    this.active = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    try {
      if (this.recorder) {
        // Detach BEFORE stop: a re-acquire path calls start() right after this,
        // and the old recorder's pending onstop must not spawn a second cycle
        // loop (or enqueue into the fresh session) once `active` flips true again.
        this.recorder.onstop = null;
        this.recorder.ondataavailable = null;
        if (this.recorder.state !== "inactive") this.recorder.stop();
      }
    } catch { /* already stopped */ }
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
  }

  /** Stop capturing, flush what we can (bounded wait), release the devices. */
  async stop(): Promise<void> {
    if (!this.active && !this.stream) return;
    const finalRecorder = this.recorder;
    this.active = false;
    if (this.cycleTimer) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    // Stop the in-flight recorder so its final chunk lands in the queue…
    try {
      if (finalRecorder && finalRecorder.state !== "inactive") finalRecorder.stop();
    } catch { /* already stopped */ }
    // …give the queue a bounded moment to drain, then release the camera.
    await Promise.race([
      (async () => {
        await new Promise((r) => setTimeout(r, 300)); // let onstop enqueue
        while (this.queue.length > 0 || this.draining) {
          await new Promise((r) => setTimeout(r, 200));
        }
      })(),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    this.sendEvent("stop");
    this.teardownMedia();
    this.onStatus("stopped");
  }
}
