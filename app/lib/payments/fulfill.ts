import { verify } from "./signature";
import { grantEntitlement } from "@/lib/server/store";

// The security-critical core, shared by the simulated gateway (mock-pay route)
// and the real provider webhook route. Verifies the signed payload, then
// idempotently grants the entitlement for the ORDER'S user (never a client-
// claimed user — the order was created server-side at checkout).
//
// NOTE: Orders are embedded directly in the signed payload rather than stored
// in a separate in-memory map. This avoids cross-Worker-instance state loss on
// Cloudflare Workers where each invocation may be a fresh process.
export async function verifyAndFulfill(
  rawPayload: string,
  signature: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!verify(rawPayload, signature)) return { ok: false, reason: "bad signature" };

  let parsed: { userId?: string; labSlug?: string | null; plan?: string; accessUntil?: string };
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return { ok: false, reason: "bad payload" };
  }
  if (!parsed.userId) return { ok: false, reason: "missing userId in payload" };

  // Per-lab grants a time-boxed window; monthly grants all-access ("*").
  const accessUntil = parsed.accessUntil ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await grantEntitlement(parsed.userId, {
    labSlug: parsed.plan === "monthly" ? "*" : parsed.labSlug ?? "",
    kind: parsed.plan === "monthly" ? "monthly" : "per-lab",
    accessUntil,
  });
  return { ok: true };
}
