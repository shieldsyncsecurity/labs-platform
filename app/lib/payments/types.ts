// Payment domain types. The simulated gateway mirrors the real provider shape
// (server creates an order, a server-verified confirmation grants access) —
// the live provider is Paytm (lib/payments/paytm.ts).

export type Plan = "per-lab" | "monthly";
export type Currency = "INR" | "USD";

export type Order = {
  id: string;
  userId: string;
  labSlug: string | null; // null for monthly all-access
  plan: Plan;
  amountMinor: number; // paise (INR) or cents (USD)
  currency: Currency;
  status: "created" | "paid" | "failed";
  createdAt: string;
};

export type CheckoutRequest = {
  userId: string;
  labSlug: string | null;
  plan: Plan;
  currency?: Currency;
};
