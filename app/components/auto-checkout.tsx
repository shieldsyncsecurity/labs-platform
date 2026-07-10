"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckoutSheet } from "@/components/checkout-sheet";
import { useAuth } from "@/lib/auth/context";

// Reads ?checkout=monthly from the URL (set by the wizard's "Continue to payment" link)
// and immediately shows the checkout sheet so the user lands straight into payment.
export function AutoCheckout() {
  const params = useSearchParams();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get("checkout") === "monthly") setOpen(true);
  }, [params]);

  if (!open) return null;

  // Not signed in yet — the sheet renders a "Sign in to continue" step on the 401 from
  // /api/payments/checkout, carrying ?returnTo back here so checkout resumes after auth.
  // Deliberately NOT a redirect-before-open: the visitor should see what they're buying
  // (plan + price) before being sent to sign-in. (Until 2026-07-10 the 401 fell through to
  // the generic "failed" phase, whose only action was "Try again" — which re-POSTs and 401s
  // forever, stranding every logged-out visitor who clicked a monthly CTA.)
  return (
    <CheckoutSheet
      labSlug={null}
      labTitle="Monthly — all AWS labs"
      plan="monthly"
      onClose={() => setOpen(false)}
      onPaid={async () => { setOpen(false); }}
    />
  );
}
