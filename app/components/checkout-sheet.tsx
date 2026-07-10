"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, priceFor } from "@/lib/payments/pricing";
import { getLab } from "@/lib/labs";
import { rulesSummary } from "@/lib/access-rules";
import type { Plan, Currency } from "@/lib/payments/types";

type CheckoutInit = { orderId: string; txnToken: string; mid: string; host: string; amountMinor: number; currency: Currency };

type PaytmCheckoutJS = { onLoad: (cb: () => void) => void; init: (config: unknown) => Promise<void>; invoke: () => void; close?: () => void };
declare global {
  interface Window {
    Paytm?: { CheckoutJS?: PaytmCheckoutJS };
  }
}

// Load Paytm's CheckoutJS for this MID (idempotent).
function loadPaytmScript(host: string, mid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Paytm?.CheckoutJS) return resolve();
    const id = "paytm-checkoutjs";
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Paytm script failed to load")));
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.src = `${host}/merchantpgpui/checkoutjs/merchants/${mid}.js`;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Paytm script failed to load"));
    document.head.appendChild(s);
  });
}

// Real Paytm checkout. The sheet opens as a locally-priced summary — the server
// order (+ Paytm txnToken) is created only when the user clicks Pay (no-auto-actions
// rule: opening the sheet must not create payment state). On completion we CONFIRM
// server-to-server (never trust the client) and the engine grants the entitlement.
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
  const [info, setInfo] = useState<CheckoutInit | null>(null);
  const [phase, setPhase] = useState<"summary" | "processing" | "confirming" | "done" | "failed" | "notlaunched" | "signin">("summary");
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const invoked = useRef(false);

  // Modal a11y: focus in on open, close on Escape.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Create + price the order server-side and initiate with Paytm → txnToken.
  // Called from pay() — the first user click — never on mount.
  async function createOrder(): Promise<CheckoutInit | null> {
    const r = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ labSlug, plan }),
    });
    const d = (await r.json().catch(() => ({}))) as Partial<CheckoutInit> & { error?: string };
    if (!r.ok || !d.txnToken) {
      // Payments aren't live yet — an expected state, not a retryable failure.
      if (r.status === 503 && d.error === "payments not available yet") {
        setPhase("notlaunched");
        return null;
      }
      // Signed out. NOT retryable — "Try again" just re-POSTs and 401s forever,
      // which stranded every logged-out visitor who clicked a monthly CTA. Offer
      // the one action that can actually work, and return them here afterwards.
      if (r.status === 401) {
        setPhase("signin");
        return null;
      }
      throw new Error(d.error ?? "Couldn't start checkout");
    }
    const init = d as CheckoutInit;
    setInfo(init);
    return init;
  }

  async function confirm(orderId: string) {
    setPhase("confirming");
    try {
      const r = await fetch("/api/payments/paytm/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const d = (await r.json().catch(() => ({}))) as { paid?: boolean; status?: string };
      if (r.ok && d.paid) setPhase("done");
      else { setErr(`Payment not confirmed${d.status ? ` (${d.status})` : ""}`); setPhase("failed"); }
    } catch {
      setErr("Couldn't confirm the payment — if you were charged, contact support and we'll sort it.");
      setPhase("failed");
    }
  }

  async function pay() {
    if (invoked.current) return;
    invoked.current = true;
    setPhase("processing");
    try {
      // First click: create + price the order now (reuse it on a retry).
      const init = info ?? (await createOrder());
      if (!init) { invoked.current = false; return; } // notlaunched path

      await loadPaytmScript(init.host, init.mid);
      const cjs = window.Paytm?.CheckoutJS;
      if (!cjs) throw new Error("Paytm checkout unavailable");

      const config = {
        root: "",
        flow: "DEFAULT",
        data: {
          orderId: init.orderId,
          token: init.txnToken,
          tokenType: "TXN_TOKEN",
          amount: (init.amountMinor / 100).toFixed(2),
        },
        merchant: { mid: init.mid, redirect: false },
        handler: {
          notifyMerchant: () => {},
          // Fires when the popup completes. We IGNORE the client-reported status and
          // confirm authoritatively server-side.
          transactionStatus: () => {
            try { cjs.close?.(); } catch {}
            void confirm(init.orderId);
          },
        },
      };

      // Paytm's documented pattern: wait for onLoad before calling init.
      // Calling init immediately after the script's onload fires can fail
      // because CheckoutJS hasn't finished its own internal setup yet.
      await new Promise<void>((resolve, reject) => {
        cjs.onLoad(function() {
          cjs.init(config).then(function() {
            cjs.invoke();
            resolve();
          }).catch(reject);
        });
      });
    } catch (e) {
      invoked.current = false;
      setErr(e instanceof Error ? e.message : "Couldn't open Paytm checkout");
      setPhase("failed");
    }
  }

  // Until the order exists, price locally from the same table the server uses
  // (server stays authoritative once the order is created).
  const price = info
    ? formatMoney(info.amountMinor, info.currency)
    : formatMoney(priceFor(labSlug, plan, "INR"), "INR");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="rounded-md bg-canvas px-2 py-1 font-mono text-xs text-muted">🔒 Secure payment · Paytm</span>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">✕</button>
        </div>

        <h2 id="checkout-title" className="mt-4 text-xl font-extrabold text-ink">
          {plan === "monthly" ? "Monthly — all AWS labs" : labTitle}
        </h2>
        <p className="mt-1 text-base text-ink-soft">
          {plan === "monthly"
            ? "Unlimited launches while subscribed."
            : labSlug
              ? rulesSummary(getLab(labSlug)?.level ?? "Beginner", getLab(labSlug)?.free ?? false)
              : "One-time access."}
        </p>

        <div className="mt-5 flex items-baseline justify-between border-y border-line py-4">
          <span className="text-base text-muted">Total</span>
          <span className="text-2xl font-extrabold text-ink">{price}</span>
        </div>

        {phase === "summary" && (
          <div className="mt-5 flex flex-col gap-2">
            <button onClick={pay} className="rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
              Pay {price} with Paytm
            </button>
            <p className="text-center text-xs text-muted">UPI · cards · net-banking · wallets — secured by Paytm</p>
          </div>
        )}

        {phase === "processing" && <p className="mt-5 font-mono text-sm text-brand">▸ Opening Paytm secure checkout…</p>}
        {phase === "confirming" && <p className="mt-5 font-mono text-sm text-brand">▸ Confirming your payment…</p>}

        {phase === "done" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-ink">✓ Payment confirmed</p>
            <p className="mt-1 text-base text-muted">Your access is unlocked.</p>
            <button onClick={() => onPaid()} className="mt-4 w-full rounded-xl bg-brand px-6 py-3 text-base font-semibold text-white hover:bg-brand-strong">
              Start the lab
            </button>
          </div>
        )}

        {phase === "notlaunched" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-ink">Online payments launch soon</p>
            <p className="mt-1 text-base text-ink-soft">
              We&apos;re completing payment-gateway approval. Leave your email on the waitlist and you&apos;ll get
              early access — or explore the free lab meanwhile.
            </p>
            <a
              href="https://shieldsyncsecurity.com/labs-wizard"
              className="mt-4 block rounded-xl bg-brand px-6 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong"
            >
              See plans &amp; pricing
            </a>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl border border-line px-6 py-3 text-base font-semibold text-ink hover:bg-canvas"
            >
              Close
            </button>
          </div>
        )}

        {phase === "signin" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-ink">Sign in to continue</p>
            <p className="mt-1 text-base text-ink-soft">
              We keep your labs on your account, so you can pick up where you left off. One click — no signup form.
            </p>
            <a
              href={`/sign-in?returnTo=${encodeURIComponent(
                typeof window === "undefined" ? "/dashboard" : window.location.pathname + window.location.search,
              )}`}
              className="mt-4 block rounded-xl bg-brand px-6 py-3 text-center text-base font-semibold text-white hover:bg-brand-strong"
            >
              Sign in
            </a>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-xl border border-line px-6 py-3 text-base font-semibold text-ink hover:bg-canvas"
            >
              Cancel
            </button>
          </div>
        )}

        {phase === "failed" && (
          <div className="mt-5">
            <p className="text-base font-semibold text-[#b91c1c]">{err ?? "Payment didn't go through"}</p>
            <button
              onClick={() => { invoked.current = false; setErr(null); setPhase("summary"); }}
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
