import type { Currency, Plan } from "./types";
import { getLab, type LabLevel } from "@/lib/labs";

// Single source of truth for prices (mirrors the marketing site). amountMinor is
// in the currency's minor unit (paise / cents). Final India numbers stay editable
// here. Free labs never reach checkout (handled by hasAccess), so no zero case.
const PER_LAB_INR: Record<LabLevel, number> = { Beginner: 19900, Intermediate: 24900, Advanced: 49900 };
const PER_LAB_USD: Record<LabLevel, number> = { Beginner: 400, Intermediate: 500, Advanced: 700 };
const MONTHLY: Record<Currency, number> = { INR: 200000, USD: 2500 };

// Optional per-lab price override (e.g. a launch promo). Empty = pure level
// pricing. amountMinor (paise/cents). (Held the temporary IAM ₹99 during Paytm
// review; reverted 2026-07-04.)
const PER_LAB_OVERRIDE: Record<string, Record<Currency, number>> = {};

export function priceFor(labSlug: string | null, plan: Plan, currency: Currency): number {
  if (plan === "monthly") return MONTHLY[currency];
  const override = labSlug ? PER_LAB_OVERRIDE[labSlug] : undefined;
  if (override) return override[currency];
  const level = (labSlug ? getLab(labSlug)?.level : undefined) ?? "Beginner";
  return currency === "INR" ? PER_LAB_INR[level] : PER_LAB_USD[level];
}

export function formatMoney(amountMinor: number, currency: Currency): string {
  const major = amountMinor / 100;
  if (currency === "INR") return `₹${major.toLocaleString("en-IN")}`;
  // Whole dollars render without the ".00" so checkout matches the marketing
  // site ("$4", not "$4.00"); keep decimals for any future non-integer price.
  return Number.isInteger(major) ? `$${major.toLocaleString("en-US")}` : `$${major.toFixed(2)}`;
}
