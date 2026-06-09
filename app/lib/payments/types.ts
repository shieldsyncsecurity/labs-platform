// Payment domain types. The simulated gateway mirrors the real Razorpay/Stripe
// shape (server creates an order, a signed webhook confirms payment) so swapping
// in a real provider later is mostly an adapter change.

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
