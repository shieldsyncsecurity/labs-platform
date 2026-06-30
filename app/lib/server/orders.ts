import type { Order } from "@/lib/payments/types";
import { engineFetch } from "./engine";

// Server-side order record — the source of truth the webhook validates a
// provider payment against, INSTEAD of a self-describing, client-replayable
// payload. Persisted in the engine (DynamoDB) so it survives across the
// stateless Cloudflare Worker invocations, exactly like entitlements.
//
// ⚠️ ENGINE TODO (required before PAYMENTS_LIVE=1): the engine handler
// (engine/handler.mjs) must expose, behind the x-engine-token guard:
//   POST /orders          { order }                 -> persist with status "created"
//   GET  /orders?orderId=  ...                       -> fetch one order
//   POST /orders/paid     { orderId, paymentId }    -> CAS created->paid, idempotent
//                                                       ({ transitioned: boolean })
// Until those land, getOrder() returns null and the webhook fails CLOSED
// (rejects "unknown order") — the safe direction. Do NOT set PAYMENTS_LIVE=1
// before the engine side and a real provider are wired.

export async function createOrder(order: Order): Promise<void> {
  try {
    const r = await engineFetch("/orders", { method: "POST", userId: order.userId, body: order });
    if (!r.ok) console.error(`createOrder: engine returned ${r.status}`);
  } catch {
    console.error("createOrder: engine unreachable");
  }
}

export async function getOrder(orderId: string): Promise<Order | null> {
  if (!orderId) return null;
  try {
    const r = await engineFetch(`/orders?orderId=${encodeURIComponent(orderId)}`, { method: "GET" });
    if (!r.ok) return null;
    const data = (await r.json()) as { order?: Order };
    return data.order ?? null;
  } catch {
    return null;
  }
}

// Confirm a paid order at the engine: the engine re-validates amount/currency vs the
// persisted order (#8), GRANTS the entitlement idempotently from the stored order, then
// records created->paid (#7). `granted` is the success contract — the webhook only
// returns ok when it's true; otherwise it 5xx's so the provider retries. Passing the
// provider-reported amount/currency lets the engine cross-check at its own boundary.
export async function markOrderPaid(
  orderId: string,
  paymentId: string,
  amountMinor?: number,
  currency?: string,
  // v2: hint the engine that this is a pay-per-lab grant with a launch cap. The
  // engine remains authoritative — it can ignore these if its own rules disagree
  // (e.g. monthly plan) — but for per-lab orders it should write the v2 shape.
  entitlementType?: "PAY_PER_LAB" | "SUBSCRIPTION" | "LIFETIME",
  maxLaunches?: number
): Promise<{ transitioned: boolean; granted: boolean }> {
  try {
    const r = await engineFetch("/orders/paid", {
      method: "POST",
      body: { orderId, paymentId, amountMinor, currency, entitlementType, maxLaunches },
    });
    if (!r.ok) return { transitioned: false, granted: false };
    const data = (await r.json()) as { transitioned?: boolean; granted?: boolean };
    return { transitioned: data.transitioned === true, granted: data.granted === true };
  } catch {
    return { transitioned: false, granted: false };
  }
}
