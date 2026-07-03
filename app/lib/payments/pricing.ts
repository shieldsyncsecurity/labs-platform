import type { Currency, Plan } from "./types";
import { getLab, type LabLevel } from "@/lib/labs";

// Single source of truth for prices (mirrors the marketing site). amountMinor is
// in the currency's minor unit (paise / cents). Final India numbers stay editable
// here. Free labs never reach checkout (handled by hasAccess), so no zero case.
const PER_LAB_INR: Record<LabLevel, number> = { Beginner: 9900, Intermediate: 24900, Advanced: 49900 };
const PER_LAB_USD: Record<LabLevel, number> = { Beginner: 300, Intermediate: 500, Advanced: 700 };
const MONTHLY: Record<Currency, number> = { INR: 200000, USD: 2500 };

// TEMP (2026-07-03): per-lab price override — IAM marked ₹99 during Paytm merchant
// review so the "from ₹99" claim maps to a real ₹99 lab (level price is ₹249).
// REVERT after Paytm approval — see PAYTM-GOLIVE-RUNBOOK.md. amountMinor (paise/cents).
const PER_LAB_OVERRIDE: Record<string, Record<Currency, number>> = {
  "iam-privilege-escalation": { INR: 9900, USD: 300 },
};

export function priceFor(labSlug: string | null, plan: Plan, currency: Currency): number {
  if (plan === "monthly") return MONTHLY[currency];
  const override = labSlug ? PER_LAB_OVERRIDE[labSlug] : undefined;
  if (override) return override[currency];
  const level = (labSlug ? getLab(labSlug)?.level : undefined) ?? "Beginner";
  return currency === "INR" ? PER_LAB_INR[level] : PER_LAB_USD[level];
}

export function formatMoney(amountMinor: number, currency: Currency): string {
  const major = amountMinor / 100;
  return currency === "INR"
    ? `₹${major.toLocaleString("en-IN")}`
    : `$${major.toFixed(2)}`;
}
