"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CopyButton from "../../_components/copy-button";

// Adds a candidate to an assessment. On success shows the freshly-generated
// candidate link right here (so the employer can copy it immediately) and
// then refreshes the server-rendered invites table below.
export default function AddCandidateForm({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [emailLink, setEmailLink] = useState(true);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  // Whether the employer ASKED us to email (captured at submit) -- so if the
  // send silently failed (e.g. SES sandbox / unverified address) we can warn
  // instead of showing a neutral "link ready" that looks like it emailed.
  const [emailWanted, setEmailWanted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);
    setNewLink(null);
    setEmailedTo(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !trimmedEmail) {
      setError("Enter both a candidate name and email.");
      return;
    }

    setPending(true);
    const wantEmail = emailLink;
    try {
      const res = await fetch("/api/portal/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          candidateName: trimmedName,
          candidateEmail: trimmedEmail,
          sendLink: wantEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Could not create invite.");
        setErrorCode(typeof data?.code === "string" ? data.code : null);
        setPending(false);
        return;
      }

      const inviteToken = data?.invite?.inviteToken ?? data?.inviteToken;
      if (inviteToken) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        setNewLink(`${origin}/a/${inviteToken}`);
      }
      setEmailedTo(data?.emailed === true ? trimmedEmail : null);
      setEmailWanted(wantEmail);
      setName("");
      setEmail("");
      setPending(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  // Requested an auto-email but it didn't go out (sandbox / unverified / send
  // error): the link is still valid, but the employer must send it themselves.
  const emailFailed = Boolean(newLink) && emailWanted && !emailedTo;

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="candidateName" className="mb-1 block text-xs font-medium text-ink-soft">
            Candidate name
          </label>
          <input
            id="candidateName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="candidateEmail" className="mb-1 block text-xs font-medium text-ink-soft">
            Candidate email
          </label>
          <input
            id="candidateEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add candidate"}
        </button>
      </form>

      <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={emailLink}
          onChange={(e) => setEmailLink(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-line-strong"
        />
        Email the candidate their link automatically
      </label>

      <p className="mt-2 text-xs text-muted">Each invite uses 1 credit.</p>

      {error ? (
        <p className="mt-2 text-sm text-rose-700">
          {error}
          {errorCode === "NO_CREDITS" ? (
            <>
              {" "}
              <Link
                href="/portal/billing"
                className="font-semibold underline underline-offset-2 hover:text-rose-900"
              >
                Go to Billing
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {newLink ? (
        <div
          className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
            emailFailed ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <div className="min-w-0 flex-1">
            <p
              className={`text-xs font-semibold ${
                emailFailed ? "text-amber-800" : "text-emerald-800"
              }`}
            >
              {emailedTo
                ? `Invitation emailed to ${emailedTo}`
                : emailFailed
                  ? "We couldn't email them automatically — copy this link and send it to the candidate:"
                  : "Candidate link ready — send it to the candidate:"}
            </p>
            <p
              className={`truncate font-mono text-xs ${
                emailFailed ? "text-amber-900" : "text-emerald-900"
              }`}
            >
              {newLink}
            </p>
          </div>
          <CopyButton value={newLink} label="Copy link" />
        </div>
      ) : null}
    </div>
  );
}
