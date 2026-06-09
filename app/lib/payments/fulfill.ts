import { verify } from "./signature";
import { getOrder, saveOrder, grantEntitlement } from "@/lib/server/store";

// The security-critical core, shared by the simulated gateway (mock-pay route)
// and the real provider webhook route. Verifies the signed payload, then
// idempotently grants the entitlement for the ORDER'S user (never a client-
// claimed user — the order was created server-side at checkout).
export function verifyAndFulfill(
  rawPayload: string,
  signature: string
): { ok: boolean; reason?: string } {
  if (!verify(rawPayload, signature)) return { ok: false, reason: "bad signature" };

  let parsed: { orderId?: string };
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return { ok: false, reason: "bad payload" };
  }
  const order = parsed.orderId ? getOrder(parsed.orderId) : undefined;
  if (!order) return { ok: false, reason: "unknown order" };
  if (order.status === "paid") return { ok: true }; // idempotent re-delivery

  order.status = "paid";
  saveOrder(order);

  // Per-lab grants a time-boxed window; monthly grants all-access ("*").
  const accessUntil = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  grantEntitlement(order.userId, {
    labSlug: order.plan === "monthly" ? "*" : order.labSlug ?? "",
    kind: order.plan === "monthly" ? "monthly" : "per-lab",
    accessUntil,
  });
  return { ok: true };
}
