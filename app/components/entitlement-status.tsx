import type { Entitlement } from "@/lib/auth/types";
import { entitlementTypeOf } from "@/lib/server/store";

// Compact one-line status pill rendered above the lab title. Only renders for
// PAY_PER_LAB (launch cap + 7-day window) and ACTIVE SUBSCRIPTION rows; LIFETIME
// and "no entitlement" return null so the page looks exactly like today.
type Props = { entitlement: Entitlement | null; labSlug?: string };

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function EntitlementStatus({ entitlement, labSlug }: Props) {
  if (!entitlement) return null;
  const type = entitlementTypeOf(entitlement);

  if (type === "PAY_PER_LAB") {
    const max = entitlement.maxLaunches ?? 3;
    const used = entitlement.launchCount ?? 0;
    const remaining = Math.max(0, max - used);
    const expiresAt = entitlement.windowExpiresAt ?? null;
    const startedAt = entitlement.windowStartedAt ?? null;
    const now = Date.now();
    const expired = expiresAt ? new Date(expiresAt).getTime() <= now : false;
    const exhausted = used >= max;

    if (expired || exhausted) {
      // PAY_PER_LAB entitlements are lab-specific, so send them back to that lab's
      // page (its panel offers "Get this lab" → CheckoutSheet) rather than a
      // "/checkout" route that doesn't exist. No labSlug → fall back to the catalog.
      const repurchaseHref = labSlug ? `/labs/${labSlug}` : "/";
      return (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink-soft">
          <strong className="text-ink">
            {expired ? "Your 7-day window has ended" : "All launches used"}
          </strong>
          <span aria-hidden className="text-muted/40">·</span>
          <a href={repurchaseHref} className="font-semibold text-brand hover:underline">
            Re-purchase to continue practising →
          </a>
        </div>
      );
    }

    if (startedAt && expiresAt) {
      return (
        <div className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink-soft">
          <strong className="text-ink">{used} of {max} launches used</strong>
          <span aria-hidden className="text-muted/40">·</span>
          <span>window: {fmt(startedAt)} → {fmt(expiresAt)}</span>
        </div>
      );
    }

    return (
      <div className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink-soft">
        <strong className="text-ink">Your 7-day window starts on first launch</strong>
        <span aria-hidden className="text-muted/40">·</span>
        <span>{max} launches included</span>
      </div>
    );
  }

  if (type === "SUBSCRIPTION" && entitlement.subscriptionStatus === "ACTIVE") {
    const renews = fmt(entitlement.subscriptionExpiresAt);
    return (
      <div className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm text-ink-soft">
        <strong className="text-ink">Unlimited via monthly plan</strong>
        {renews && (
          <>
            <span aria-hidden className="text-muted/40">·</span>
            <span>renews {renews}</span>
          </>
        )}
      </div>
    );
  }

  return null;
}
