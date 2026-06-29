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

  // Not signed in yet — the checkout sheet itself handles the 401 from /api/payments/checkout
  // and shows an error, which is fine. But if we want a smoother UX we could redirect to
  // sign-in first. For now, let the sheet surface the sign-in error.
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
