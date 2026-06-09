"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { mockPaymentClient, type CheckoutInfo } from "@/lib/payments/client";
import { formatMoney } from "@/lib/payments/pricing";
import type { Plan } from "@/lib/payments/types";

// A simulated payment sheet that mirrors a real gateway (Razorpay/Stripe):
// it asks the server to create an order, then "pays" via the mock gateway,
// which fires the signed webhook -> server grants the entitlement.
export function CheckoutSheet({
  labSlug,
  labTitle,
  plan,
  onClose,
  onPaid,
}: {
  labSlug: string | null;
  labTitle: string;
  plan: Plan;
  onClose: () => void;
  onPaid: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const [info, setInfo] = useState<CheckoutInfo | null>(null);
  const [phase, setPhase] = useState<"loading" | "summary" | "processing" | "done" | "failed">("loading");

  useEffect(() => {
    if (!user) return;
    mockPaymentClient
      .checkout({ userId: user.id, labSlug, plan })
      .then((i) => {
        setInfo(i);
        setPhase("summary");
      })
      .catch(() => setPhase("failed"));
  }, [user, labSlug, plan]);

  async function pay(outcome: "success" | "failure") {
    if (!info) return;
    setPhase("processing");
    const res = await mockPaymentClient.pay(info.orderId, outcome);
    setPhase(res.status === "paid" ? "done" : "failed");
  }

  const price = info ? formatMoney(info.amountMinor, info.currency) : "…";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs text-muted">
            Simulated checkout (no real charge)
          </span>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        <h2 className="mt-4 text-xl font-extrabold text-ink">
          {plan === "monthly" ? "Monthly — all AWS labs" : labTitle}
        </h2>
        <p className="mt-1 text-base text-ink-soft">
          {plan === "monthly" ? "Unlimited launches while subscribed." : "One-time — 24h access window."}
        </p>

        <div className="mt-5 flex items-baseline justify-between border-y border-line py-4">
          <span className="text-base text-muted">Total</span>
          <span className="text-2xl font-extrabold text-ink">{price}</span>
        </div>

        {phase === "loading" && <p className="mt-5 text-base text-muted">Preparing order…</p>}

        {phase === "summary" && (
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => pay("success")}
              className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
            >
              Pay {price}
            </button>
            <button
              onClick={() => pay("failure")}
              className="rounded-xl border border-line px-6 py-2.5 text-sm font-semibold text-muted hover:bg-canvas"
            >
              Simulate a failed payment
            </button>
          </div>
        )}

        {phase === "processing" && (
          <p className="mt-5 font-mono text-sm text-brand">▸ Processing payment & confirming via webhook…</p>
        )}

        {phase === "done" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-ink">✓ Payment confirmed</p>
            <p className="mt-1 text-sm text-muted">
              The signed webhook granted your access server-side.
            </p>
            <button
              onClick={() => onPaid()}
              className="mt-4 w-full rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong"
            >
              Start the lab
            </button>
          </div>
        )}

        {phase === "failed" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-[#b91c1c]">Payment didn&apos;t go through</p>
            <button
              onClick={() => setPhase("summary")}
              className="mt-3 w-full rounded-xl border border-line px-6 py-3 text-base font-semibold text-ink hover:bg-canvas"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
