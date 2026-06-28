"use client";

import { useState } from "react";

// Where lab-idea requests go. Mirrors the marketing contact flow (WhatsApp prefill,
// no backend) — keeps it a real, working "request" with zero infra. Hardcoded like
// the other cross-surface links in this app (marketing URL, labsUrl).
const WHATSAPP = "https://wa.me/919717433114";

export function LabRequest() {
  const [idea, setIdea] = useState("");

  const submit = () => {
    const body = idea.trim()
      ? `ShieldSync Labs — lab request: ${idea.trim()}`
      : "ShieldSync Labs — I'd like to suggest a lab idea:";
    window.open(`${WHATSAPP}?text=${encodeURIComponent(body)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="mt-10 rounded-2xl border border-line bg-canvas p-6">
      <h2 className="text-lg font-extrabold text-ink">Want a lab we don&apos;t have yet?</h2>
      <p className="mt-1 text-base text-ink-soft">
        Tell us what to build — your idea shapes what we add next.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="e.g. GuardDuty triage, KMS key-policy hardening, VPC exposure…"
          aria-label="Your lab idea"
          className="flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-base text-ink outline-none placeholder:text-muted focus:border-brand"
        />
        <button
          onClick={submit}
          className="rounded-xl bg-brand px-5 py-2.5 text-base font-semibold text-white hover:bg-brand-strong"
        >
          Request a lab →
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">Opens WhatsApp with your idea — no account needed.</p>
    </section>
  );
}
