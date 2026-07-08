import type { Currency, Plan } from "./types";
import { getLab, type LabLevel } from "@/lib/labs";
import { priceOverrideMinor } from "@/lib/lab-settings";

// Single source of truth for prices (mirrors the marketing site). amountMinor is
// in the currency's minor unit (paise / cents). Free labs never reach checkout
// (handled by hasAccess), so no zero case.
// FLAT pay-per-lab pricing (owner call 2026-07-07): every paid lab is Rs 249 /
// $4 regardless of level. Level-keyed shape kept in case tiers return.
const PER_LAB_INR: Record<LabLevel, number> = { Beginner: 24900, Intermediate: 24900, Advanced: 24900 };
const PER_LAB_USD: Record<LabLevel, number> = { Beginner: 400, Intermediate: 400, Advanced: 400 };
const MONTHLY: Record<Currency, number> = { INR: 200000, USD: 2500 };

// Per-lab price overrides now come from app/lab-settings.json (edited via the
// /admin/labs panel or by hand — see lib/lab-settings.ts). null = flat pricing.
export function priceFor(labSlug: string | null, plan: Plan, currency: Currency): number {
  if (plan === "monthly") return MONTHLY[currency];
  const override = priceOverrideMinor(labSlug, currency);
  if (override != null) return override;
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
