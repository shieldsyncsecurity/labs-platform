"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShieldMark } from "@/components/brand";

// ── Types ────────────────────────────────────────────────────────────────

type InviteStatus =
  | "created"
  | "consented"
  | "verified"
  | "booked"
  | "started"
  | "submitted"
  | "revoked"
  | "expired";

type Invite = {
  status: InviteStatus;
  candidateName?: string;
  assessmentId?: string;
  expiresAt?: string;
  otpLocked?: boolean;
  consentVersion?: string;
  name?: string;
  labSlug?: string;
  hintsOn?: boolean;
  orgName?: string;
  slotKey?: string;
};

// Azure candidate access (CLI-first). Azure labs hand the candidate a pooled
// service-principal credential to `az login` with (they have no Entra identity),
// scoped to their session resource group. Present only for azure-track assessments;
// AWS labs use consoleUrl instead.
type AzAccess = {
  method: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
  subscriptionId: string;
  resourceGroup: string;
  loginCommand: string;
  setSubscription: string;
};

type StartResponse = {
  sessionId: string;
  status: "leasing" | "active";
  consoleUrl: string;
  azAccess?: AzAccess | null;
  scoredExpiresAt: string;
  expiresAt: string;
  warm?: boolean;
  reconnected?: boolean;
};

// Phases the candidate progresses through, driven by invite.status + local
// sub-flow state (otp/schedule/room are not persisted invite statuses, they
// are steps that happen while status is "created"/"consented"/"verified"/etc).
type Phase =
  | "loading"
  | "invalid"
  | "consent"
  | "otp"
  | "schedule"
  | "ready"
  | "starting"
  | "room"
  | "resumeFailed"
  | "reflection"
  | "done";

const CONSENT_VERSION = "v1";

// Hard grace period after the room timer expires: the candidate gets this long
// on the reflection card before we auto-submit for them.
const GRACE_MS = 5 * 60 * 1000;

// Shared button styles. The candidate room is app UI (rounded-lg, not marketing
// pills) and every action needs a visible keyboard focus ring. Defined once so
// the styles never drift across the cards below.
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const BTN_PRIMARY =
  `rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;
const BTN_SECONDARY =
  `rounded-lg border border-line-strong px-6 py-3 text-sm font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong ${FOCUS_RING}`;

function isPast(iso?: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < Date.now();
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ── Slot generation (client-side only — /ent/book is the real guard) ──────

type SlotOption = { key: string; label: string };

function generateSlots(): SlotOption[] {
  const slots: SlotOption[] = [];
  const hours = [9, 11, 14, 16];
  const now = new Date();
  for (let d = 1; d <= 5; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    for (const h of hours) {
      const slot = new Date(day);
      slot.setHours(h, 0, 0, 0);
      const key = slot.toISOString();
      const label = slot.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      slots.push({ key, label });
    }
  }
  return slots;
}

// ── Component ───────────────────────────────────────────────────────────

export default function CandidateFlow({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // consent
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);

  // otp
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState(false);

  // schedule
  const [slots, setSlots] = useState<SlotOption[] | null>(null);
  const [slotsCapacity, setSlotsCapacity] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookedSlot, setBookedSlot] = useState<string | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // start/room
  const [starting, setStarting] = useState(false);
  const [session, setSession] = useState<StartResponse | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // reflection
  const [reflection, setReflection] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);

  // post-expiry grace: set when the room timer hits 0. While active, the
  // reflection card shows a hard countdown and we auto-submit at 0 (or on
  // tab close via sendBeacon) so an expired session is never stranded.
  const [graceDeadline, setGraceDeadline] = useState<number | null>(null);
  const [graceLeftMs, setGraceLeftMs] = useState<number | null>(null);
  const reflectionRef = useRef("");
  const autoFiredRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const beaconSentRef = useRef(false);

  useEffect(() => {
    reflectionRef.current = reflection;
  }, [reflection]);

  // ── Load invite on mount ────────────────────────────────────────────
  const loadInvite = useCallback(async () => {
    setPhase("loading");
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
      if (res.status === 404) {
        setErrorMsg("This assessment link is not valid.");
        setPhase("invalid");
        return;
      }
      const data = await readJson(res);
      if (!res.ok) {
        setErrorMsg("This assessment link is not valid.");
        setPhase("invalid");
        return;
      }

      const inv = data as Invite;
      setInvite(inv);

      if (inv.otpLocked) {
        setErrorMsg(
          "This link has been locked after too many incorrect codes. Please contact the organization that invited you."
        );
        setPhase("invalid");
        return;
      }
      if (isPast(inv.expiresAt)) {
        setErrorMsg("This link has expired.");
        setPhase("invalid");
        return;
      }
      if (inv.status === "revoked") {
        setErrorMsg("This assessment link is no longer active.");
        setPhase("invalid");
        return;
      }

      routeByStatus(inv.status);
    } catch {
      setErrorMsg("Could not load this assessment link. Check your connection and try again.");
      setPhase("invalid");
    }
  }, [token]);

  // Route to the right phase given the invite's current engine status.
  // Called after initial load AND after any mutation that changes status.
  const routeByStatus = (status: InviteStatus) => {
    if (status === "created") {
      setPhase("consent");
    } else if (status === "consented") {
      setPhase("otp");
    } else if (status === "verified") {
      setPhase("schedule");
    } else if (status === "booked") {
      setPhase("ready");
    } else if (status === "started") {
      // Reconnect case: candidate refreshed mid-assessment. Re-enter the room
      // and let it re-poll /api/start to fetch a fresh console URL.
      setPhase("room");
    } else if (status === "submitted") {
      // Already submitted (including a prior auto-submit) -- show the Done
      // card, never the reflection form.
      setPhase("done");
    } else {
      setErrorMsg("This assessment link is no longer active.");
      setPhase("invalid");
    }
  };

  useEffect(() => {
    loadInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Phase 2: consent ────────────────────────────────────────────────
  const handleConsent = async () => {
    if (!consentChecked || consentBusy) return;
    setConsentBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token, consentVersion: CONSENT_VERSION }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setErrorMsg("Could not record your consent. Please try again.");
        setConsentBusy(false);
        return;
      }
      setInvite((prev) => (prev ? { ...prev, status: data.status ?? "consented" } : prev));
      setPhase("otp");
    } catch {
      setErrorMsg("Could not record your consent. Please try again.");
    } finally {
      setConsentBusy(false);
    }
  };

  // ── Phase 3: otp ────────────────────────────────────────────────────
  const sendOtp = useCallback(async (isResend = false) => {
    setOtpBusy(true);
    setOtpError(null);
    setResendNotice(false);
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const code = data?.code as string | undefined;
        const retryAfter = typeof data?.retryAfter === "number" ? data.retryAfter : undefined;
        if (code === "OTP_COOLDOWN") {
          setOtpError(
            retryAfter
              ? `Please wait ${retryAfter}s before requesting another code.`
              : "Please wait a moment before requesting another code."
          );
        } else if (code === "OTP_DAILY_CAP") {
          setOtpError(
            "Too many codes requested today. Please contact the organization that invited you."
          );
        } else if (code === "NOT_SENDABLE") {
          setErrorMsg("This assessment link is no longer active.");
          setPhase("invalid");
        } else if (code === "LINK_EXPIRED") {
          setErrorMsg("This link has expired.");
          setPhase("invalid");
        } else {
          setOtpError("Could not send a code. Please try again in a moment.");
        }
        return;
      }
      setOtpSent(true);
      if (isResend) {
        setResendNotice(true);
        setTimeout(() => setResendNotice(false), 6000);
      }
      if (data?.devCode) {
        setDevCode(data.devCode);
        setOtpCode(data.devCode);
      }
    } catch {
      setOtpError("Could not send a code. Please try again in a moment.");
    } finally {
      setOtpBusy(false);
    }
  }, [token]);

  // Auto-send the first code on entering the OTP phase.
  useEffect(() => {
    if (phase === "otp" && !otpSent && !otpBusy) {
      sendOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6 || otpBusy) return;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token, code: otpCode }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const code = data?.code as string | undefined;
        if (code === "LINK_EXPIRED") {
          setErrorMsg("This link has expired.");
          setPhase("invalid");
          return;
        }
        if (code === "NOT_VERIFIABLE") {
          setErrorMsg("This assessment link is no longer active.");
          setPhase("invalid");
          return;
        }
        setOtpError("Could not verify the code. Please try again.");
        return;
      }
      if (data?.locked) {
        setErrorMsg(
          "This link has been locked after too many incorrect codes. Please contact the organization that invited you."
        );
        setPhase("invalid");
        return;
      }
      if (data?.expired) {
        setOtpError("That code has expired. Send a new one below.");
        setOtpSent(false);
        return;
      }
      if (data?.ok) {
        setInvite((prev) => (prev ? { ...prev, status: "verified" } : prev));
        setPhase("schedule");
        return;
      }
      const left = typeof data?.attemptsLeft === "number" ? data.attemptsLeft : undefined;
      setOtpError(
        left !== undefined
          ? `That code was incorrect. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "That code was incorrect. Please try again."
      );
    } catch {
      setOtpError("Could not verify the code. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  // ── Phase 4: schedule ───────────────────────────────────────────────
  const loadSlots = useCallback(async () => {
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      const res = await fetch("/api/slots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        setScheduleError("Could not load scheduling. Please try again.");
        return;
      }
      setSlotsCapacity(typeof data?.capacity === "number" ? data.capacity : null);
      if (data?.capacity > 0) {
        setSlots(generateSlots());
      }
    } catch {
      setScheduleError("Could not load scheduling. Please try again.");
    } finally {
      setScheduleBusy(false);
    }
  }, [token]);

  useEffect(() => {
    if (phase === "schedule" && slotsCapacity === null && !scheduleBusy) {
      loadSlots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleBookSlot = async () => {
    if (!selectedSlot || scheduleBusy) return;
    setScheduleBusy(true);
    setScheduleError(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token, slotKey: selectedSlot }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        // Our /api/book route wraps engine errors as { error, detail } where
        // detail is the raw engine body (e.g. { error: "SLOT_FULL" }).
        const engineError = data?.detail?.error ?? data?.error;
        if (engineError === "SLOT_FULL") {
          setSlots((prev) => (prev ? prev.filter((s) => s.key !== selectedSlot) : prev));
          setSelectedSlot(null);
          setScheduleError("That time just filled up. Please pick another.");
          return;
        }
        if (engineError === "LINK_EXPIRED") {
          setErrorMsg("This link has expired.");
          setPhase("invalid");
          return;
        }
        setScheduleError("Could not book that time. Please try again.");
        return;
      }
      setBookedSlot(data?.slotKey ?? selectedSlot);
      setInvite((prev) => (prev ? { ...prev, status: "booked" } : prev));
      setPhase("ready");
    } catch {
      setScheduleError("Could not book that time. Please try again.");
    } finally {
      setScheduleBusy(false);
    }
  };

  // ── Phase 5/6: start + room polling ─────────────────────────────────
  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const callStart = useCallback(async (): Promise<StartResponse | { error: string } | null> => {
    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        // /api/start wraps engine errors as { error, detail } where detail is
        // the raw engine body (e.g. { error: "NO_CAPACITY", retry: true } or
        // { error: "LINK_EXPIRED" }/{ error: "NOT_STARTABLE" }).
        const engineError = data?.detail?.error ?? data?.error ?? "START_FAILED";
        return { error: engineError };
      }
      return data as StartResponse;
    } catch {
      return { error: "NETWORK_ERROR" };
    }
  }, [token]);

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setPhase("starting");
    setErrorMsg(null);

    const result = await callStart();
    if (!result || "error" in result) {
      const code = result && "error" in result ? result.error : "START_FAILED";
      if (code === "LINK_EXPIRED") {
        setErrorMsg("This link has expired.");
        setPhase("invalid");
        setStarting(false);
        return;
      }
      if (code === "NO_CAPACITY") {
        setErrorMsg("All environments are busy right now. Please try starting again in a minute.");
      } else {
        setErrorMsg("Could not start the assessment. Please try again.");
      }
      setPhase("ready");
      setStarting(false);
      return;
    }

    setSession(result);
    setInvite((prev) => (prev ? { ...prev, status: "started" } : prev));

    if (result.status === "active") {
      setPhase("room");
      setStarting(false);
      return;
    }

    // Still leasing (cold account) — poll /api/start every ~5s until active.
    setPhase("starting");
    pollRef.current = setInterval(async () => {
      const poll = await callStart();
      if (!poll || "error" in poll) return; // transient — keep polling
      setSession(poll);
      if (poll.status === "active") {
        stopPolling();
        setPhase("room");
        setStarting(false);
      }
    }, 5000);
  };

  // Reconnect path: invite.status is already "started" on load (e.g. the
  // candidate refreshed the room mid-assessment). Re-call /api/start to
  // fetch a fresh console URL + current status, then enter the same
  // leasing/active handling as a fresh start.
  useEffect(() => {
    if (phase === "room" && !session) {
      (async () => {
        const result = await callStart();
        if (!result || "error" in result) {
          const code = result && "error" in result ? result.error : "START_FAILED";
          if (code === "LINK_EXPIRED") {
            setErrorMsg("This link has expired.");
            setPhase("invalid");
            return;
          }
          // Transient failure (network blip, engine hiccup) mid-assessment:
          // offer a Retry instead of dead-ending on the invalid card.
          setErrorMsg("Could not resume your assessment session.");
          setPhase("resumeFailed");
          return;
        }
        setSession(result);
        if (result.status !== "active") {
          pollRef.current = setInterval(async () => {
            const poll = await callStart();
            if (!poll || "error" in poll) return;
            setSession(poll);
            if (poll.status === "active") stopPolling();
          }, 5000);
        }
      })();
    }
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => stopPolling, []);

  // ── Countdown timer in the room ─────────────────────────────────────
  useEffect(() => {
    if (phase !== "room" || !session?.scoredExpiresAt) return;
    const target = new Date(session.scoredExpiresAt).getTime();
    const tick = () => {
      const left = target - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        // Time is up: move to the reflection card with a hard grace window,
        // after which we auto-submit. Only arm the deadline once.
        setGraceDeadline((prev) => prev ?? Date.now() + GRACE_MS);
        setPhase("reflection");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, session?.scoredExpiresAt]);

  // ── Phase 7: reflection / submit ─────────────────────────────────────
  const handleSubmit = async (auto = false) => {
    // Ref guard alongside state: the grace-countdown effect calls a captured
    // (stale) closure of this function, so `submitBusy` alone can read false
    // while a manual submit is in flight -- the ref is stable across closures
    // and closes the double-fire race.
    if (submitBusy || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: token, reflection: reflectionRef.current, auto }),
      });
      await readJson(res);
      if (!res.ok) {
        setErrorMsg("Could not submit. Please try again.");
        setSubmitBusy(false);
        return;
      }
      setInvite((prev) => (prev ? { ...prev, status: "submitted" } : prev));
      setPhase("done");
    } catch {
      setErrorMsg("Could not submit. Please try again.");
    } finally {
      submitInFlightRef.current = false;
      setSubmitBusy(false);
    }
  };

  // Grace countdown after timer expiry: tick every second; at 0, auto-submit
  // exactly once with auto:true. A manual submit during grace still works and
  // simply wins the race (the engine's submit is idempotent).
  useEffect(() => {
    if (phase !== "reflection" || graceDeadline === null) return;
    const tick = () => {
      const left = graceDeadline - Date.now();
      setGraceLeftMs(Math.max(0, left));
      if (left <= 0 && !autoFiredRef.current) {
        autoFiredRef.current = true;
        handleSubmit(true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, graceDeadline]);

  // While in reflection-after-expiry, closing or hiding the tab must not
  // strand the session: fire a best-effort auto-submit via sendBeacon (or a
  // keepalive fetch fallback). The engine's idempotent submit makes any
  // duplicate delivery harmless.
  useEffect(() => {
    if (phase !== "reflection" || graceDeadline === null) return;
    const sendAutoSubmit = () => {
      if (beaconSentRef.current) return;
      beaconSentRef.current = true;
      const payload = JSON.stringify({
        inviteToken: token,
        reflection: reflectionRef.current,
        auto: true,
      });
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/submit", new Blob([payload], { type: "application/json" }));
      } else {
        fetch("/api/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };
    const onPageHide = () => sendAutoSubmit();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendAutoSubmit();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase, graceDeadline, token]);

  // ── Derived display helpers ─────────────────────────────────────────
  const orgName = invite?.orgName || "the hiring team";
  const countdown = useMemo(() => formatCountdown(remainingMs), [remainingMs]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-10 sm:py-16">
      <header className="mb-8 text-center">
        <ShieldMark size={30} className="mx-auto mb-3 block" />
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">ShieldSync Assessment</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">
          {invite?.name || "Security Assessment"}
        </h1>
        <p className="mt-1 text-sm text-muted">Invited by {orgName}</p>
      </header>

      <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-2 text-center text-xs text-muted sm:hidden">
        This works best on a laptop — you will need to use the AWS console.
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        {phase === "loading" && <LoadingCard />}
        {phase === "invalid" && <InvalidCard message={errorMsg ?? "This assessment link is not valid."} />}
        {phase === "consent" && invite && (
          <ConsentCard
            invite={invite}
            orgName={orgName}
            checked={consentChecked}
            onCheck={setConsentChecked}
            busy={consentBusy}
            error={errorMsg}
            onContinue={handleConsent}
          />
        )}
        {phase === "otp" && (
          <OtpCard
            code={otpCode}
            onCodeChange={setOtpCode}
            onVerify={handleVerifyOtp}
            onResend={() => sendOtp(true)}
            busy={otpBusy}
            error={otpError}
            sent={otpSent}
            resent={resendNotice}
            devCode={devCode}
          />
        )}
        {phase === "schedule" && (
          <ScheduleCard
            orgName={orgName}
            capacity={slotsCapacity}
            slots={slots}
            selected={selectedSlot}
            onSelect={setSelectedSlot}
            onBook={handleBookSlot}
            busy={scheduleBusy}
            error={scheduleError}
          />
        )}
        {phase === "ready" && (
          <ReadyCard
            bookedSlot={bookedSlot ?? invite?.slotKey ?? null}
            onStart={handleStart}
            error={errorMsg}
            busy={starting}
          />
        )}
        {phase === "starting" && <StartingCard />}
        {phase === "room" && (
          <RoomCard
            name={invite?.name}
            hintsOn={invite?.hintsOn}
            consoleUrl={session?.consoleUrl}
            azAccess={session?.azAccess}
            countdown={countdown}
            waiting={!session || session.status !== "active"}
            onSubmit={() => setPhase("reflection")}
          />
        )}
        {phase === "resumeFailed" && (
          <ResumeErrorCard
            message={errorMsg ?? "Could not resume your assessment session."}
            onRetry={() => {
              setErrorMsg(null);
              setPhase("room");
            }}
          />
        )}
        {phase === "reflection" && (
          <ReflectionCard
            reflection={reflection}
            onChange={setReflection}
            onSubmit={() => handleSubmit()}
            onBack={() => setPhase("room")}
            busy={submitBusy}
            error={errorMsg}
            graceCountdown={graceDeadline !== null ? formatCountdown(graceLeftMs ?? GRACE_MS) : null}
          />
        )}
        {phase === "done" && <DoneCard orgName={orgName} />}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function LoadingCard() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner />
      <p className="text-sm text-muted">Loading your assessment...</p>
    </div>
  );
}

function InvalidCard({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-base font-semibold text-ink">{message}</p>
      <p className="text-sm text-muted">
        If you believe this is a mistake, please contact the organization that invited you.
      </p>
    </div>
  );
}

function ResumeErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div>
        <p className="text-base font-semibold text-ink">{message}</p>
        <p className="mt-1 text-sm text-muted">
          Your assessment session is still there -- this was a connection problem, not a
          submission.
        </p>
      </div>
      <button type="button" onClick={onRetry} className={BTN_PRIMARY}>
        Retry
      </button>
    </div>
  );
}

function ConsentCard({
  invite,
  orgName,
  checked,
  onCheck,
  busy,
  error,
  onContinue,
}: {
  invite: Invite;
  orgName: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">{invite.name || "Security assessment"}</h2>
        <p className="mt-2 text-sm text-ink-soft">
          This is a real, timed AWS security task — plan for about 60 minutes. You will work
          directly in a live AWS console.
        </p>
        {invite.hintsOn && (
          <p className="mt-2 text-sm text-ink-soft">
            Hints are available during the assessment, but using them reduces your score.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-canvas p-4 text-sm text-ink-soft">
        <p className="font-medium text-ink">Before you continue</p>
        <p className="mt-1">
          During this assessment we record the actions you take in a temporary AWS account and
          retain the results for 24 months, shared with {orgName}. Sub-processors: AWS,
          Cloudflare, and Google (Gemini).
        </p>
        <p className="mt-2">
          See our{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-strong underline underline-offset-2"
          >
            Privacy Policy
          </a>{" "}
          and{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-strong underline underline-offset-2"
          >
            Terms
          </a>{" "}
          for how your data is handled and how to request deletion.
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-ink-soft">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
        />
        <span>I understand and consent.</span>
      </label>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button type="button" disabled={!checked || busy} onClick={onContinue} className={BTN_PRIMARY}>
        {busy ? "Saving..." : "Continue"}
      </button>
    </div>
  );
}

function OtpCard({
  code,
  onCodeChange,
  onVerify,
  onResend,
  busy,
  error,
  sent,
  resent,
  devCode,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  onVerify: () => void;
  onResend: () => void;
  busy: boolean;
  error: string | null;
  sent: boolean;
  resent: boolean;
  devCode: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Verify it is you</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {sent
            ? "We sent a 6-digit code to your email."
            : "Sending a 6-digit code to your email..."}
        </p>
        {resent && (
          <p className="mt-2 rounded-md border border-brand/40 bg-brand/5 px-3 py-2 text-sm text-brand-strong">
            A new code is on its way to your email.
          </p>
        )}
        {devCode && (
          <p className="mt-2 rounded-md bg-canvas px-3 py-2 font-mono text-xs text-muted">
            Dev mode code: {devCode}
          </p>
        )}
      </div>

      <input
        inputMode="numeric"
        maxLength={6}
        placeholder="000000"
        value={code}
        aria-label="6-digit verification code"
        autoComplete="one-time-code"
        onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full rounded-lg border border-line-strong px-4 py-3 text-center text-lg tracking-[0.5em] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button type="button" disabled={code.length !== 6 || busy} onClick={onVerify} className={BTN_PRIMARY}>
        {busy ? "Verifying..." : "Verify"}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onResend}
        className={`rounded text-sm font-medium text-brand hover:text-brand-strong disabled:opacity-50 ${FOCUS_RING}`}
      >
        Resend code
      </button>
    </div>
  );
}

function ScheduleCard({
  orgName,
  capacity,
  slots,
  selected,
  onSelect,
  onBook,
  busy,
  error,
}: {
  orgName: string;
  capacity: number | null;
  slots: SlotOption[] | null;
  selected: string | null;
  onSelect: (key: string) => void;
  onBook: () => void;
  busy: boolean;
  error: string | null;
}) {
  if (capacity === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Spinner />
        <p className="text-sm text-muted">Loading available times...</p>
      </div>
    );
  }

  if (capacity === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-base font-semibold text-ink">Assessment scheduling opens soon</p>
        <p className="text-sm text-muted">{orgName} will be in touch.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">Pick a time</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Choose a time to take your assessment. You will have about 60 minutes once you start.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Available times"
        className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2"
      >
        {slots?.map((s) => (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={selected === s.key}
            onClick={() => onSelect(s.key)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${FOCUS_RING} ${
              selected === s.key
                ? "border-brand bg-brand/5 text-brand-strong"
                : "border-line text-ink-soft hover:border-brand"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button type="button" disabled={!selected || busy} onClick={onBook} className={BTN_PRIMARY}>
        {busy ? "Booking..." : "Book this time"}
      </button>
    </div>
  );
}

function ReadyCard({
  bookedSlot,
  onStart,
  error,
  busy,
}: {
  bookedSlot: string | null;
  onStart: () => void;
  error: string | null;
  busy: boolean;
}) {
  // slotKey is a slot key string (e.g. "2026-07-29T09:00"). Format it in the
  // candidate's local words; if parsing fails, stay honest and show the raw key.
  let label: string | null = null;
  if (bookedSlot) {
    const t = new Date(bookedSlot);
    label = Number.isNaN(t.getTime())
      ? bookedSlot
      : t.toLocaleString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">You are all set</h2>
        {label && <p className="mt-2 text-sm text-ink-soft">Your booked time: {label}</p>}
        <p className="mt-2 text-sm text-ink-soft">
          When you are ready, start the assessment below. The clock starts as soon as you begin.
        </p>
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button type="button" disabled={busy} onClick={onStart} className={BTN_PRIMARY}>
        {busy ? "Starting..." : "Start assessment"}
      </button>
    </div>
  );
}

function StartingCard() {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner />
      <p className="text-base font-semibold text-ink">Preparing your environment</p>
      <p className="text-sm text-muted">This usually takes 1-2 minutes.</p>
    </div>
  );
}

// A read-only command line with a copy button — used by the Azure CLI-first room.
function CopyCmd({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-xs text-ink">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — candidate can still select + copy */
          }
        }}
        className="shrink-0 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function RoomCard({
  name,
  hintsOn,
  consoleUrl,
  azAccess,
  countdown,
  waiting,
  onSubmit,
}: {
  name?: string;
  hintsOn?: boolean;
  consoleUrl?: string;
  azAccess?: AzAccess | null;
  countdown: string;
  waiting: boolean;
  onSubmit: () => void;
}) {
  if (waiting) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Spinner />
        <p className="text-base font-semibold text-ink">Preparing your environment</p>
        <p className="text-sm text-muted">This usually takes 1-2 minutes.</p>
      </div>
    );
  }

  const header = (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold text-ink">{name || "Assessment"}</h2>
      <span className="rounded-full bg-canvas px-3 py-1 font-mono text-sm font-semibold text-ink">
        {countdown}
      </span>
    </div>
  );

  // Azure CLI-first: the candidate signs in with a session service-principal
  // credential (no Azure Portal login — they have no Entra identity) and works
  // from the Azure CLI, scoped to their own resource group.
  if (azAccess) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="text-sm text-ink-soft">
          Secure the Azure Storage account in your resource group, then submit. You work from the
          Azure CLI with the session credentials below.
        </p>
        {hintsOn && (
          <p className="text-sm text-ink-soft">Hints are available for this assessment.</p>
        )}
        <ol className="flex flex-col gap-3 text-sm text-ink-soft">
          <li>
            <span className="font-semibold text-ink">1.</span> Install the Azure CLI if you don't
            have it:{" "}
            <a
              href="https://aka.ms/installazurecli"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-strong underline"
            >
              aka.ms/installazurecli
            </a>
          </li>
          <li>
            <span className="font-semibold text-ink">2.</span> Sign in with your session credentials
            (valid for this assessment only):
            <div className="mt-2">
              <CopyCmd text={azAccess.loginCommand} />
            </div>
          </li>
          <li>
            <span className="font-semibold text-ink">3.</span> Point the CLI at your subscription:
            <div className="mt-2">
              <CopyCmd text={azAccess.setSubscription} />
            </div>
          </li>
          <li>
            <span className="font-semibold text-ink">4.</span> Your target is resource group{" "}
            <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-xs text-ink">
              {azAccess.resourceGroup}
            </code>
            . Find and fix the leaky storage account, then submit.
          </li>
        </ol>
        <button type="button" onClick={onSubmit} className={BTN_SECONDARY}>
          Submit assessment
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      <p className="text-sm text-ink-soft">
        Complete the security task in the AWS console, then submit.
      </p>

      {hintsOn && (
        <p className="text-sm text-ink-soft">Hints are available for this assessment.</p>
      )}

      <a
        href={consoleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-center ${BTN_PRIMARY}`}
      >
        Open AWS Console
      </a>

      <button type="button" onClick={onSubmit} className={BTN_SECONDARY}>
        Submit assessment
      </button>
    </div>
  );
}

function ReflectionCard({
  reflection,
  onChange,
  onSubmit,
  onBack,
  busy,
  error,
  graceCountdown,
}: {
  reflection: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
  graceCountdown: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">
          {graceCountdown !== null ? "Time is up" : "One last thing"}
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          In 3-5 sentences, what did you find and how did you fix it?
        </p>
      </div>

      {graceCountdown !== null && (
        <p className="rounded-lg border border-brand/40 bg-brand/5 px-4 py-2 text-sm font-medium text-brand-strong">
          Auto-submitting in {graceCountdown} -- add your reflection now.
        </p>
      )}

      <textarea
        rows={6}
        value={reflection}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Your reflection"
        placeholder="Describe what you found and how you addressed it..."
        className="w-full rounded-lg border border-line-strong px-4 py-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button type="button" disabled={busy} onClick={onSubmit} className={BTN_PRIMARY}>
        {busy ? "Submitting..." : "Submit"}
      </button>

      {graceCountdown === null && (
        <button type="button" onClick={onBack} className={BTN_SECONDARY}>
          Back to the task
        </button>
      )}
    </div>
  );
}

function DoneCard({ orgName }: { orgName: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-base font-semibold text-ink">Submitted.</p>
      <p className="text-sm text-muted">{orgName} will be in touch.</p>
    </div>
  );
}

function Spinner() {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-brand"
      aria-label="Loading"
    />
  );
}

function formatCountdown(ms: number | null): string {
  if (ms === null) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
