import { verify } from "./signature";
import { grantEntitlement } from "@/lib/server/store";

// DEV SIMULATOR ONLY — used solely by the mock-pay route (ALLOW_MOCK_PAY,
// hard-404 in production). This verifies an INTERNALLY mock-signed payload, so
// it is inherently replayable by anyone who can obtain that payload and MUST
// NOT back the real-provider trust path. The production webhook
// (app/api/payments/webhook) does NOT import this — it verifies the provider's
// own signature (lib/payments/provider.ts) against a server-persisted order
// (lib/server/orders.ts) with amount + idempotency checks. Do not re-wire the
// webhook to this function.
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
