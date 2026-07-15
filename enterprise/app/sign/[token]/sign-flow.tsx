"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Client half of the public signing page: send code -> enter code + typed full
// name + explicit checkbox -> accept. The server page re-renders as "signed"
// after a successful accept (router.refresh()). All error rendering maps the
// WHITELISTED codes our /api/sign/* routes forward -- raw engine bodies never
// reach this component.
export default function SignFlow({
  token,
  signerEmailMasked,
  initialLocked,
}: {
  token: string;
  signerEmailMasked: string;
  initialLocked: boolean;
}) {
  const router = useRouter();
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState("");
  const [typedName, setTypedName] = useState("");
  const [agree, setAgree] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [locked, setLocked] = useState(initialLocked);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    initialLocked
      ? "Too many incorrect codes -- this link is locked. Contact ShieldSync to proceed."
      : null,
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode() {
    if (sending || cooldown > 0 || locked) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/sign/otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        emailed?: boolean;
        code?: string;
        retryAfter?: number;
      };
      if (res.ok) {
        setCodeSent(true);
        setCooldown(45);
        setNotice(
          data.emailed === false
            ? "We couldn't send the email just now. Wait a moment and request a new code."
            : `Code sent to ${signerEmailMasked}. It expires in 10 minutes.`,
        );
      } else if (data.code === "OTP_COOLDOWN") {
        setCodeSent(true);
        setCooldown(data.retryAfter ?? 45);
        setNotice("A code was sent moments ago -- check your inbox (and spam).");
      } else if (data.code === "OTP_DAILY_CAP") {
        setError("Too many codes requested today. Try again tomorrow or contact ShieldSync.");
      } else if (data.code === "ALREADY_SIGNED") {
        router.refresh();
      } else if (data.code === "LINK_EXPIRED") {
        setError("This signing link has expired. Ask ShieldSync for a fresh one.");
      } else {
        setError("Could not send a code. Please try again.");
      }
    } catch {
      setError("Could not send a code. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    if (accepting || locked) return;
    if (!agree) {
      setError("Tick the acceptance checkbox to continue.");
      return;
    }
    setAccepting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/sign/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, code, typedName, agree }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        already?: boolean;
        attemptsLeft?: number;
        locked?: boolean;
        expired?: boolean;
        code?: string;
        error?: string;
      };
      if (res.ok && (data.ok || data.already)) {
        // Server page re-renders as the executed-document view.
        router.refresh();
        return;
      }
      if (data.locked) {
        setLocked(true);
        setError("Too many incorrect codes -- this link is locked. Contact ShieldSync to proceed.");
      } else if (data.expired) {
        setError("That code has expired. Request a new one below.");
        setCodeSent(false);
        setCode("");
      } else if (typeof data.attemptsLeft === "number") {
        setError(
          `That code doesn't match. ${data.attemptsLeft} attempt${data.attemptsLeft === 1 ? "" : "s"} left.`,
        );
      } else if (data.code === "LINK_EXPIRED") {
        setError("This signing link has expired. Ask ShieldSync for a fresh one.");
      } else {
        setError(data.error ?? "Could not record the acceptance. Please try again.");
      }
    } catch {
      setError("Could not record the acceptance. Check your connection and try again.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-line bg-canvas p-5 sm:p-6">
      <h2 className="text-base font-bold text-ink">Accept this document</h2>
      <p className="mt-1 text-sm text-muted">
        First we verify it&apos;s you: we&apos;ll email a one-time code to{" "}
        <span className="font-medium text-ink-soft">{signerEmailMasked}</span>, the address this
        document was issued to.
      </p>

      <div className="mt-4">
        <button
          type="button"
          onClick={sendCode}
          disabled={sending || cooldown > 0 || locked}
          className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending
            ? "Sending…"
            : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : codeSent
                ? "Resend code"
                : "Email me a code"}
        </button>
      </div>

      {notice ? <p className="mt-3 text-sm text-emerald-700">{notice}</p> : null}
      {error ? (
        <p className="mt-3 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {codeSent && !locked ? (
        <form onSubmit={accept} className="mt-5 space-y-4">
          <div>
            <label htmlFor="sign-code" className="block text-sm font-medium text-ink-soft">
              One-time code from your email
            </label>
            <input
              id="sign-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="mt-1 w-40 rounded-lg border border-line-strong bg-surface px-3 py-2 text-lg tracking-[0.3em] text-ink focus:border-brand focus:outline-none"
              placeholder="000000"
            />
          </div>
          <div>
            <label htmlFor="sign-name" className="block text-sm font-medium text-ink-soft">
              Your full name (typed as your signature)
            </label>
            <input
              id="sign-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-1 w-full max-w-sm rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              placeholder="e.g. Priya Sharma"
            />
          </div>
          <label className="flex items-start gap-3 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              required
              className="mt-0.5 h-4 w-4 rounded border-line-strong accent-[#d97706]"
            />
            <span>
              I have read this document and I accept it. I understand my typed name, verified
              email, the date and time, and my IP address will be recorded as evidence of
              electronic acceptance.
            </span>
          </label>
          <button
            type="submit"
            disabled={accepting || !agree || code.length !== 6 || typedName.trim().length < 2}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {accepting ? "Recording acceptance…" : "Accept document"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
