"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

const FIELD_CLS =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const FALLBACK_MAILTO =
  "mailto:info@shieldsyncsecurity.com?subject=" +
  encodeURIComponent("ShieldSync Enterprise - walkthrough");

export default function BookDemoForm({ defaultTopic }: { defaultTopic: "walkthrough" | "pricing" }) {
  const pathname = usePathname();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [topic, setTopic] = useState<string>(defaultTopic);
  const [message, setMessage] = useState("");
  // Honeypot -- visually hidden, labelled to be skipped; bots that autofill it
  // get a silent success from /api/leads.
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Please add your name.");
      return;
    }
    if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("That email address doesn't look right.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim(),
          topic,
          message: message.trim(),
          source: pathname,
          website,
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 || data?.error === "ALREADY_RECEIVED") {
        // First submission from this email already landed -- that's a success
        // from the prospect's point of view.
        setDone(true);
        return;
      }
      setError(typeof data?.error === "string" ? data.error : "Could not send your request.");
      setPending(false);
    } catch {
      setError("Could not send your request.");
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="py-6 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
          <svg viewBox="0 0 16 16" fill="none" className="h-6 w-6" aria-hidden="true">
            <path
              d="M3.5 8.5l3 3 6-7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className="mt-4 text-lg font-semibold text-ink">Request received</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""} — we&apos;ll get back to
          you at <span className="font-medium text-ink">{email.trim()}</span> within one business
          day.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="lead-name" className="mb-1 block text-sm font-medium text-ink-soft">
            Your name
          </label>
          <input
            id="lead-name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_CLS}
          />
        </div>
        <div>
          <label htmlFor="lead-email" className="mb-1 block text-sm font-medium text-ink-soft">
            Work email
          </label>
          <input
            id="lead-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD_CLS}
          />
        </div>
      </div>

      <div>
        <label htmlFor="lead-company" className="mb-1 block text-sm font-medium text-ink-soft">
          Company <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="lead-company"
          type="text"
          autoComplete="organization"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={FIELD_CLS}
        />
      </div>

      <div>
        <label htmlFor="lead-topic" className="mb-1 block text-sm font-medium text-ink-soft">
          What do you need?
        </label>
        <select
          id="lead-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className={FIELD_CLS}
        >
          <option value="walkthrough">A product walkthrough</option>
          <option value="pricing">Pricing for my volume</option>
          <option value="other">Something else</option>
        </select>
      </div>

      <div>
        <label htmlFor="lead-message" className="mb-1 block text-sm font-medium text-ink-soft">
          Who are you hiring? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id="lead-message"
          rows={3}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. 2 cloud security engineers, shortlist of 8, deciding this month"
          className={FIELD_CLS}
        />
      </div>

      {/* Honeypot: off-screen, out of the tab order, ignored by screen readers. */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="lead-website">Website</label>
        <input
          id="lead-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}{" "}
          <a href={FALLBACK_MAILTO} className="font-medium underline">
            Email us instead
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request the walkthrough"}
      </button>
      <p className="text-center text-xs leading-relaxed text-muted">
        We use these details only to reply to this request — no mailing lists.
      </p>
    </form>
  );
}
