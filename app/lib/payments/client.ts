import type { Currency, Plan } from "./types";

// Client-side gateway seam. The mock talks to our /api/payments/* routes.
// The live path opens Paytm JS Checkout and confirms server-side via
// /api/payments/paytm/confirm — the rest of the app (the checkout sheet,
// entitlements) is unchanged.

export type CheckoutInfo = {
  orderId: string;
  signedPayload: string;
  signature: string;
  amountMinor: number;
  currency: Currency;
};
export type PayResult = { status: "paid" | "failed" };

export interface PaymentClient {
  checkout(input: { userId: string; labSlug: string | null; plan: Plan; currency?: Currency }): Promise<CheckoutInfo>;
  pay(info: CheckoutInfo, outcome: "success" | "failure"): Promise<PayResult>;
}

export const mockPaymentClient: PaymentClient = {
  async checkout(input) {
    const r = await fetch("/api/payments/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) throw new Error("checkout failed");
    return r.json();
  },
  async pay(info, outcome) {
    const r = await fetch("/api/payments/mock-pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedPayload: info.signedPayload, signature: info.signature, outcome }),
    });
    return { status: r.ok ? "paid" : "failed" };
  },
};
