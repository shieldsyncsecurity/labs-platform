"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { getLab } from "@/lib/labs";
import { CheckoutSheet } from "@/components/checkout-sheet";

type LaunchResult = {
  sessionId: string;
  accountId: string;
  consoleUrl: string;
  expiresInSeconds: number;
};
type Phase = "idle" | "provisioning" | "ready" | "nocapacity" | "error" | "ending";

export function LaunchButton({ slug }: { slug: string }) {
  const { user, hasAccess, refreshEntitlements } = useAuth();
  const [showCheckout, setShowCheckout] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<LaunchResult | null>(null);
  const lab = getLab(slug);

  if (!user) {
    return (
      <Link href={`/sign-in?returnTo=${encodeURIComponent(`/labs/${slug}`)}`} className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
        Sign in to start
      </Link>
    );
  }

  if (!hasAccess(slug)) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button
          onClick={() => setShowCheckout(true)}
          className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
        >
          Get this lab
        </button>
        <span className="text-sm text-muted">One-time purchase — simulated checkout, grants a 24h access window.</span>
        {showCheckout && (
          <CheckoutSheet
            labSlug={slug}
            labTitle={lab?.title ?? "Lab"}
            plan="per-lab"
            onClose={() => setShowCheckout(false)}
            onPaid={async () => {
              await refreshEntitlements();
              setShowCheckout(false);
            }}
          />
        )}
      </div>
    );
  }

  async function launch() {
    setPhase("provisioning");
    try {
      const r = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user!.id, labSlug: slug }),
      });
      if (r.status === 503) return setPhase("nocapacity");
      if (!r.ok) return setPhase("error");
      setResult((await r.json()) as LaunchResult);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }

  async function endLab() {
    if (!result) return;
    setPhase("ending");
    try {
      await fetch("/api/end-lab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: result.sessionId }),
      });
    } catch {
      /* ignore */
    }
    setResult(null);
    setPhase("idle");
  }

  if (phase === "provisioning") {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="font-mono text-sm text-brand">▸ Provisioning your isolated AWS lab…</p>
        <p className="mt-1 text-sm text-muted">Leasing a clean account, deploying the scenario, minting your console link. This takes a minute or two.</p>
      </div>
    );
  }

  if (phase === "nocapacity") {
    return (
      <div className="rounded-xl border border-line bg-canvas p-4">
        <p className="font-semibold text-ink">All lab seats are busy right now.</p>
        <p className="mt-1 text-sm text-ink-soft">Every isolated account is in use. Try again in a few minutes — one frees up as soon as another learner finishes.</p>
        <button onClick={() => setPhase("idle")} className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface">
          Try again
        </button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-xl border border-line bg-canvas p-4">
        <p className="font-semibold text-[#b91c1c]">Couldn&apos;t start the lab.</p>
        <button onClick={() => setPhase("idle")} className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface">
          Retry
        </button>
      </div>
    );
  }

  if (phase === "ready" && result) {
    return (
      <div className="rounded-2xl border border-line bg-canvas p-5">
        <p className="text-base font-extrabold text-ink">Your lab is live 🎉</p>
        <p className="mt-1 text-sm text-ink-soft">
          Your own isolated AWS account, scoped + time-boxed (~{Math.round(result.expiresInSeconds / 60)} min). It auto-wipes when you finish.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={result.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
          >
            Open your lab ↗
          </a>
          <button
            onClick={endLab}
            className="rounded-xl border border-line px-5 py-3 text-base font-semibold text-ink hover:bg-surface"
          >
            End &amp; wipe lab
          </button>
        </div>
        <p className="mt-3 font-mono text-xs text-muted">session {result.sessionId} · account {result.accountId}</p>
      </div>
    );
  }

  if (phase === "ending") {
    return <div className="rounded-xl border border-line bg-surface p-4 font-mono text-sm text-brand">▸ Wiping your lab…</div>;
  }

  return (
    <button onClick={launch} className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
      Launch lab
    </button>
  );
}
