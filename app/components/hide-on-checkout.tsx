"use client";

import { useSearchParams } from "next/navigation";

// Hides its children when the page is opened with a `?checkout=` intent (e.g.
// /?checkout=monthly, set by the marketing wizard's "Continue to payment" or the
// homepage's Monthly card). Used to drop the plan-picker behind the checkout sheet:
// a buyer who already chose a plan shouldn't be re-shown the plan menu — least of all
// the "Free lab — no card needed" card, which undercuts the sale they came to make.
// Must render inside a <Suspense> boundary (useSearchParams) on statically-rendered pages.
export function HideOnCheckout({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  if (params.get("checkout")) return null;
  return <>{children}</>;
}
