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

// Atomic, idempotent transition created -> paid. Returns true ONLY for the call
// that actually flipped the status, so out of N webhook retries for the same
// payment exactly one grants the entitlement. Any failure returns false, which
// the webhook treats as "do not grant" (fail closed).
export async function markOrderPaid(orderId: string, paymentId: string): Promise<boolean> {
  try {
    const r = await engineFetch("/orders/paid", { method: "POST", body: { orderId, paymentId } });
    if (!r.ok) return false;
    const data = (await r.json()) as { transitioned?: boolean };
    return data.transitioned === true;
  } catch {
    return false;
  }
}
